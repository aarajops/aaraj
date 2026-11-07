import { createHash, randomUUID } from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  CheckoutDraftDetailSchema,
  CheckoutDraftListSchema,
  CheckoutDraftSaveResultSchema,
  type CheckoutDraftListQuery,
  type CheckoutDraftOutcomeInput,
  type CheckoutDraftSave,
} from "@aaraj/contracts";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { CartService, type CartQuoteOwner } from "../cart/cart.service.js";
import { lockCartOwner } from "../cart/cart-owner-lock.js";
import { parseGuestCartId } from "../cart/cart-cookie.js";
import { DatabaseService } from "../platform/database/database.service.js";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import { QuoteService } from "../quote/quote.service.js";
import { checkoutCallSuppression, checkoutDraft } from "./orders-schema.js";
import {
  decryptDraftValue,
  encryptDraftValue,
  hashSuppressedPhone,
} from "./checkout-draft-crypto.js";

const DraftFormSchema = z.strictObject({
  recipientName: z.string().max(120),
  phone: z.string().regex(/^\+8801[3-9]\d{8}$/),
  doorstepDetails: z.string().max(400),
});
const DraftItemsSchema = CheckoutDraftDetailSchema.shape.items;
const DraftDestinationSchema = CheckoutDraftDetailSchema.shape.destination;
type DraftRow = typeof checkoutDraft.$inferSelect;
const DRAFT_INACTIVITY_MINUTES = 10;
const DRAFT_RETENTION_DAYS = 7;

export function draftOwnerHash(owner: CartQuoteOwner): string {
  return createHash("sha256")
    .update(
      owner.kind === "customer"
        ? `customer:${owner.customerId}`
        : `guest:${owner.guestCartHash}`,
    )
    .digest("hex");
}

export function draftOwner(row: DraftRow): CartQuoteOwner {
  if (row.customerId) return { kind: "customer", customerId: row.customerId };
  if (row.guestCartHash)
    return { kind: "guest", guestCartHash: row.guestCartHash };
  throw new Error("Checkout draft owner is invalid.");
}

export function readDraftForm(row: DraftRow) {
  return DraftFormSchema.parse(
    decryptDraftValue(row.id, "form", row.formCiphertext),
  );
}

export function readDraftGuestCartId(row: DraftRow): string | undefined {
  if (!row.guestCartIdCiphertext) return undefined;
  const value = decryptDraftValue(
    row.id,
    "guest-cart",
    row.guestCartIdCiphertext,
  );
  if (typeof value !== "string" || !parseGuestCartId(value)) {
    throw new Error("Checkout draft guest-cart identity is invalid.");
  }
  return value;
}

export function readDraftItems(row: DraftRow) {
  return DraftItemsSchema.parse(row.items);
}

export function readDraftDestination(row: DraftRow) {
  return DraftDestinationSchema.parse(row.destination);
}

function normalizePhone(value: string): string {
  const trimmed = value.trim().replace(/[\s-]/g, "");
  const normalized = /^01[3-9]\d{8}$/.test(trimmed) ? `+88${trimmed}` : trimmed;
  if (!/^\+8801[3-9]\d{8}$/.test(normalized)) {
    throw new UnprocessableEntityException(
      "Enter a valid Bangladesh mobile number.",
    );
  }
  return normalized;
}

@Injectable()
export class CheckoutDraftsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly cart: CartService,
    private readonly quotes: QuoteService,
    private readonly audit: AuditService,
  ) {}

  async save(
    customerId: string | undefined,
    guestCartId: string | undefined,
    input: CheckoutDraftSave,
  ) {
    const context = await this.cart.getQuoteContext(customerId, guestCartId);
    if (!context.owner || context.cart.lines.length === 0) return null;
    const owner = context.owner;
    const phone = normalizePhone(input.phone);
    const form = DraftFormSchema.parse({
      recipientName: input.recipientName.normalize("NFC").trim(),
      phone,
      doorstepDetails: input.doorstepDetails.normalize("NFC").trim(),
    });
    const items = context.cart.lines.map((line) => ({
      variantId: line.variantId,
      productName: line.product.name,
      color: line.product.color,
      sizeLabel: line.product.sizeLabel,
      quantity: line.quantity,
    }));
    let quote = null;
    if (input.quoteId) {
      try {
        const current = await this.quotes.getCurrentForCheckout(
          customerId,
          guestCartId,
          input.quoteId,
        );
        if (current.cartRevision === context.cart.revision) quote = current;
      } catch {
        // A quote is optional for draft capture. Conversion always reprices.
      }
    }
    const ownerHash = draftOwnerHash(owner);
    const phoneHash = hashSuppressedPhone(phone);
    return this.database.db.transaction(async (tx) => {
      await lockCartOwner(
        tx,
        owner.kind,
        owner.kind === "customer" ? owner.customerId : owner.guestCartHash,
      );
      const currentCart = await this.cart.getQuoteContext(
        customerId,
        guestCartId,
      );
      if (
        !currentCart.owner ||
        currentCart.cart.lines.length === 0 ||
        currentCart.cart.revision !== context.cart.revision ||
        currentCart.cart.lines.length !== items.length ||
        items.some(
          (line, index) =>
            line.variantId !== currentCart.cart.lines[index]?.variantId ||
            line.quantity !== currentCart.cart.lines[index]?.quantity,
        )
      ) {
        return null;
      }
      const [suppressed] = await tx
        .select({ phoneHash: checkoutCallSuppression.phoneHash })
        .from(checkoutCallSuppression)
        .where(eq(checkoutCallSuppression.phoneHash, phoneHash))
        .limit(1);
      if (suppressed) return null;
      if (
        owner.kind === "guest" &&
        (await this.cart.hasGuestRevisionReceipt(
          owner.guestCartHash,
          context.cart.revision,
          tx,
        ))
      )
        return null;
      const [existing] = await tx
        .select()
        .from(checkoutDraft)
        .where(eq(checkoutDraft.ownerHash, ownerHash))
        .for("update")
        .limit(1);
      if (
        existing?.outcome === "declined" ||
        existing?.outcome === "do_not_contact"
      ) {
        return CheckoutDraftSaveResultSchema.parse({
          id: existing.id,
          version: existing.version,
        });
      }
      if (existing && context.cart.revision < existing.cartRevision) {
        throw new ConflictException("A newer checkout draft exists.", {
          errorCode: "DRAFT_STALE",
        });
      }
      if (
        existing &&
        input.expectedVersion !== null &&
        input.expectedVersion !== existing.version
      ) {
        throw new ConflictException(
          "The checkout draft changed in another tab.",
          { errorCode: "DRAFT_STALE" },
        );
      }
      const id = existing?.id ?? randomUUID();
      const formCiphertext = encryptDraftValue(id, "form", form);
      const guestCartIdCiphertext =
        owner.kind === "guest"
          ? encryptDraftValue(id, "guest-cart", parseGuestCartId(guestCartId)!)
          : null;
      const destination = quote?.destination
        ? {
            geographyVersion: quote.destination.geographyVersion,
            divisionId: quote.destination.divisionId,
            districtId: quote.destination.districtId,
            ...(quote.destination.upazilaId
              ? { upazilaId: quote.destination.upazilaId }
              : {}),
          }
        : null;
      const changed =
        !existing ||
        existing.cartRevision !== context.cart.revision ||
        JSON.stringify(readDraftForm(existing)) !== JSON.stringify(form) ||
        JSON.stringify(existing.items) !== JSON.stringify(items) ||
        JSON.stringify(existing.destination) !== JSON.stringify(destination) ||
        existing.estimatedTotalBdt !== (quote?.totalBdt ?? null) ||
        existing.deliveryZone !== (quote?.delivery.zone ?? null);
      if (!changed)
        return CheckoutDraftSaveResultSchema.parse({
          id,
          version: existing.version,
        });
      const now = new Date();
      if (existing) {
        const [updated] = await tx
          .update(checkoutDraft)
          .set({
            cartRevision: context.cart.revision,
            version: existing.version + 1,
            formCiphertext,
            guestCartIdCiphertext,
            items,
            estimatedTotalBdt: quote?.totalBdt ?? null,
            deliveryZone: quote?.delivery.zone ?? null,
            destination,
            lastCustomerActivityAt: now,
          })
          .where(eq(checkoutDraft.id, id))
          .returning();
        return CheckoutDraftSaveResultSchema.parse({
          id,
          version: updated!.version,
        });
      }
      const [created] = await tx
        .insert(checkoutDraft)
        .values({
          id,
          ownerHash,
          customerId: owner.kind === "customer" ? owner.customerId : null,
          guestCartHash: owner.kind === "guest" ? owner.guestCartHash : null,
          guestCartIdCiphertext,
          cartRevision: context.cart.revision,
          formCiphertext,
          items,
          estimatedTotalBdt: quote?.totalBdt ?? null,
          deliveryZone: quote?.delivery.zone ?? null,
          destination,
          lastCustomerActivityAt: now,
        })
        .returning();
      return CheckoutDraftSaveResultSchema.parse({
        id,
        version: created!.version,
      });
    });
  }

  async list(query: CheckoutDraftListQuery) {
    const eligible = and(
      sql`${checkoutDraft.lastCustomerActivityAt} <= clock_timestamp() - (${DRAFT_INACTIVITY_MINUTES} * interval '1 minute')`,
      sql`${checkoutDraft.lastCustomerActivityAt} >= clock_timestamp() - (${DRAFT_RETENTION_DAYS} * interval '1 day')`,
      inArray(checkoutDraft.outcome, [
        "new",
        "no_answer",
        "interested",
        "call_back",
      ]),
      sql`(${checkoutDraft.outcome} <> 'no_answer' or ${checkoutDraft.attemptCount} < 2)`,
      sql`(${checkoutDraft.callbackAt} is null or ${checkoutDraft.callbackAt} <= clock_timestamp())`,
    );
    const active: DraftRow[] = [];
    const formCache = new Map<string, ReturnType<typeof readDraftForm>>();
    let scanned = query.offset;
    let exhausted = false;
    while (active.length <= query.limit && !exhausted) {
      const rows = await this.database.db
        .select()
        .from(checkoutDraft)
        .where(eligible)
        .orderBy(
          asc(checkoutDraft.lastCustomerActivityAt),
          asc(checkoutDraft.id),
        )
        .limit(query.limit + 1)
        .offset(scanned);
      if (rows.length < query.limit + 1) exhausted = true;
      const forms = new Map(rows.map((row) => [row.id, readDraftForm(row)]));
      for (const [id, form] of forms) formCache.set(id, form);
      const guestReceipts = await this.cart.findGuestRevisionReceiptKeys(
        rows.flatMap((row) =>
          row.guestCartHash
            ? [{ guestCartHash: row.guestCartHash, revision: row.cartRevision }]
            : [],
        ),
      );
      const suppressedHashes = await this.findSuppressedPhoneHashes(
        [...forms.values()].map((form) => hashSuppressedPhone(form.phone)),
      );
      for (const row of rows) {
        scanned += 1;
        if (
          row.guestCartHash &&
          guestReceipts.has(`${row.guestCartHash}:${row.cartRevision}`)
        )
          continue;
        if (suppressedHashes.has(hashSuppressedPhone(forms.get(row.id)!.phone)))
          continue;
        active.push(row);
        if (active.length > query.limit) break;
      }
    }
    const selected = active.slice(0, query.limit);
    return CheckoutDraftListSchema.parse({
      rows: selected.map((row) => this.listRow(row, formCache.get(row.id)!)),
      limit: query.limit,
      offset: query.offset,
      hasMore: active.length > query.limit,
      nextOffset: active.length > query.limit ? scanned - 1 : null,
    });
  }

  async detail(id: string, staffId: string) {
    const row = await this.getEligible(id);
    await this.database.db.transaction(async (tx) => {
      await this.audit.append(tx, {
        actorType: "user",
        actorId: staffId,
        eventType: "commerce.checkout_draft_viewed",
        subjectType: "checkout_draft",
        subjectId: id,
        metadata: {},
      });
    });
    const form = readDraftForm(row);
    return CheckoutDraftDetailSchema.parse({
      ...this.listRow(row),
      phone: form.phone,
      doorstepDetails: form.doorstepDetails,
      version: row.version,
      cartRevision: row.cartRevision,
      destination: readDraftDestination(row),
      callbackAt: row.callbackAt?.toISOString() ?? null,
    });
  }

  async outcome(id: string, staffId: string, input: CheckoutDraftOutcomeInput) {
    const row = await this.getEligible(id);
    const owner = draftOwner(row);
    return this.database.db.transaction(async (tx) => {
      await lockCartOwner(
        tx,
        owner.kind,
        owner.kind === "customer" ? owner.customerId : owner.guestCartHash,
      );
      const [current] = await tx
        .select()
        .from(checkoutDraft)
        .where(eq(checkoutDraft.id, id))
        .for("update")
        .limit(1);
      if (
        !current ||
        current.version !== input.expectedVersion ||
        !this.isOldEnough(current)
      ) {
        throw new ConflictException(
          "The draft changed. Refresh before calling.",
          { errorCode: "DRAFT_STALE" },
        );
      }
      if (
        ["declined", "do_not_contact"].includes(current.outcome) ||
        (current.outcome === "no_answer" && current.attemptCount >= 2) ||
        (current.callbackAt && current.callbackAt.getTime() > Date.now())
      ) {
        throw new ConflictException(
          "This checkout is not currently available for calling.",
          { errorCode: "DRAFT_NOT_CALLABLE" },
        );
      }
      if (
        owner.kind === "guest" &&
        (await this.cart.hasGuestRevisionReceipt(
          owner.guestCartHash,
          current.cartRevision,
          tx,
        ))
      ) {
        throw new ConflictException("This guest cart has already been used.", {
          errorCode: "DRAFT_STALE",
        });
      }
      if (
        input.outcome === "call_back" &&
        (!input.callbackAt ||
          new Date(input.callbackAt).getTime() <= Date.now())
      ) {
        throw new UnprocessableEntityException(
          "Choose a future callback time.",
        );
      }
      if (input.outcome !== "call_back" && input.callbackAt) {
        throw new UnprocessableEntityException(
          "Callback time is only valid for a callback.",
        );
      }
      const form = readDraftForm(current);
      if (await this.isSuppressed(form.phone, tx))
        throw new ConflictException("Calls to this number are suppressed.");
      const attemptCount = current.attemptCount + 1;
      const [updated] = await tx
        .update(checkoutDraft)
        .set({
          outcome: input.outcome,
          attemptCount,
          callbackAt: input.callbackAt ? new Date(input.callbackAt) : null,
          version: current.version + 1,
        })
        .where(eq(checkoutDraft.id, id))
        .returning();
      if (input.outcome === "do_not_contact") {
        await tx
          .insert(checkoutCallSuppression)
          .values({ phoneHash: hashSuppressedPhone(form.phone) })
          .onConflictDoNothing();
      }
      await this.audit.append(tx, {
        actorType: "user",
        actorId: staffId,
        eventType: "commerce.checkout_draft_call_outcome",
        subjectType: "checkout_draft",
        subjectId: id,
        metadata: { outcome: input.outcome, attemptCount },
      });
      return CheckoutDraftDetailSchema.parse({
        ...this.listRow(updated!),
        phone: form.phone,
        doorstepDetails: form.doorstepDetails,
        version: updated!.version,
        cartRevision: updated!.cartRevision,
        destination: readDraftDestination(updated!),
        callbackAt: updated!.callbackAt?.toISOString() ?? null,
      });
    });
  }

  async getEligible(id: string): Promise<DraftRow> {
    const [row] = await this.database.db
      .select()
      .from(checkoutDraft)
      .where(eq(checkoutDraft.id, id))
      .limit(1);
    if (
      !row ||
      !this.isOldEnough(row) ||
      !this.isRetained(row) ||
      ["declined", "do_not_contact"].includes(row.outcome)
    )
      throw new NotFoundException("Checkout draft is not available.");
    if (
      row.guestCartHash &&
      (await this.cart.hasGuestRevisionReceipt(
        row.guestCartHash,
        row.cartRevision,
      ))
    )
      throw new NotFoundException("Checkout draft is not available.");
    if (await this.isSuppressed(readDraftForm(row).phone))
      throw new NotFoundException("Checkout draft is not available.");
    return row;
  }

  isOldEnough(row: DraftRow): boolean {
    return (
      row.lastCustomerActivityAt.getTime() <=
      Date.now() - DRAFT_INACTIVITY_MINUTES * 60_000
    );
  }

  private isRetained(row: DraftRow): boolean {
    return (
      row.lastCustomerActivityAt.getTime() >=
      Date.now() - DRAFT_RETENTION_DAYS * 86_400_000
    );
  }

  private async isSuppressed(
    phone: string,
    tx?: AuditTransaction,
  ): Promise<boolean> {
    const database = tx ?? this.database.db;
    const [row] = await database
      .select({ phoneHash: checkoutCallSuppression.phoneHash })
      .from(checkoutCallSuppression)
      .where(eq(checkoutCallSuppression.phoneHash, hashSuppressedPhone(phone)))
      .limit(1);
    return Boolean(row);
  }

  private async findSuppressedPhoneHashes(
    phoneHashes: readonly string[],
  ): Promise<Set<string>> {
    if (phoneHashes.length === 0) return new Set();
    const rows = await this.database.db
      .select({ phoneHash: checkoutCallSuppression.phoneHash })
      .from(checkoutCallSuppression)
      .where(
        inArray(checkoutCallSuppression.phoneHash, [...new Set(phoneHashes)]),
      );
    return new Set(rows.map(({ phoneHash }) => phoneHash));
  }

  private listRow(row: DraftRow, form = readDraftForm(row)) {
    return {
      id: row.id,
      customerName: form.recipientName || "Name not entered",
      maskedPhone: `${form.phone.slice(0, 6)}••••${form.phone.slice(-2)}`,
      items: readDraftItems(row),
      estimatedTotalBdt: row.estimatedTotalBdt,
      deliveryZone: row.deliveryZone,
      outcome: row.outcome,
      attemptCount: row.attemptCount,
      lastCustomerActivityAt: row.lastCustomerActivityAt.toISOString(),
    };
  }

  async cleanup(batchSize = 500): Promise<number> {
    const deleted = await this.database.db.execute(sql`
      with expired as (
        select id from orders.checkout_draft
        where last_customer_activity_at < clock_timestamp() - (${DRAFT_RETENTION_DAYS} * interval '1 day')
        order by last_customer_activity_at, id limit ${batchSize}
      )
      delete from orders.checkout_draft where id in (select id from expired)
      returning id
    `);
    return deleted.rowCount ?? 0;
  }
}
