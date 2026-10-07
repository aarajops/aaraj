import { createHash, randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import sharp from "sharp";
import request from "supertest";
import { eq } from "drizzle-orm";
import { vi } from "vitest";
import { auth } from "../src/auth/auth.js";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";
import { AccessService } from "../src/platform/authorization/access.service.js";
import { AuditService } from "../src/platform/audit/audit.service.js";
import { auditEvent } from "../src/platform/audit/audit-schema.js";
import { DatabaseService } from "../src/platform/database/database.service.js";
import {
  catalogProduct,
  catalogProductVariant,
  catalogProductMedia,
} from "../src/catalog/catalog-schema.js";
import { R2Storage } from "../src/catalog/media/r2-storage.js";
import { MAX_CATALOG_MEDIA_UPLOAD_BYTES } from "@aaraj/contracts";

interface Account {
  id: string;
  email: string;
  cookie: string;
}

interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  sha256: string;
}

interface PutDerivativeInput {
  key: string;
  body: Buffer;
  sha256: string;
}

interface ReadDerivativeInput {
  key: string;
  sha256: string;
  sizeBytes: number;
}

class MemoryR2Storage {
  readonly objects = new Map<string, Buffer>();
  failNextPut = false;
  failNextDerivativePut = false;
  failNextDelete = false;
  holdPuts: Array<{ started: () => void; wait: Promise<void> }> = [];

  async putQuarantinedObject(input: PutObjectInput): Promise<void> {
    const hold = this.holdPuts.shift();
    if (hold) {
      hold.started();
      await hold.wait;
    }
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("simulated R2 put failure");
    }
    this.objects.set(input.key, Buffer.from(input.body));
  }

  async putDerivativeObject(input: PutDerivativeInput): Promise<void> {
    if (this.failNextDerivativePut) {
      this.failNextDerivativePut = false;
      throw new Error("simulated R2 derivative put failure");
    }
    this.objects.set(input.key, Buffer.from(input.body));
  }

  async deleteMediaObjects(keys: string[]): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("simulated R2 delete failure");
    }
    for (const key of keys) this.objects.delete(key);
  }

  async getPublishedDerivative(input: ReadDerivativeInput): Promise<Buffer> {
    const body = this.objects.get(input.key);
    if (
      !body ||
      body.byteLength !== input.sizeBytes ||
      createHash("sha256").update(body).digest("hex") !== input.sha256
    ) {
      throw new Error("simulated missing R2 derivative");
    }
    return Buffer.from(body);
  }
}

const origin = "http://localhost:3000";
const password = "aaraj-media-e2e-password-123";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWO4I+d2R86NAYUCAFJZB4Fg78ImAAAAAElFTkSuQmCC",
  "base64",
);

describe("catalog media management", () => {
  let app: INestApplication;
  let database: DatabaseService;
  let operator: Account;
  let customer: Account;
  let recoveryManager: Account;
  let productId: string;
  let variantId: string;
  const storage = new MemoryR2Storage();

  async function createAccount(name: string): Promise<Account> {
    const email = `${name}-${randomUUID()}@media-e2e.example`;
    const response = await auth.api.signUpEmail({
      body: { name, email, password },
      headers: new Headers({ Origin: origin }),
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string } };
    return {
      id: body.user.id,
      email,
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    };
  }

  async function createProduct(slug: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/api/v1/catalog/products")
      .set("Cookie", operator.cookie)
      .set("Origin", origin)
      .send({
        slug,
        name: "Media test product",
        audience: "unisex",
        variants: [
          {
            sku: `${slug}-sku`,
            color: "Black",
            sizeLabel: "M",
            price: null,
          },
        ],
        reason: "Create isolated media test product",
      })
      .expect(201);
    return response.body.id as string;
  }

  function upload(
    targetProductId: string,
    input: {
      commandId: string;
      variantId?: string;
      altText?: string;
      reason?: string;
    },
    file = png,
    filename = "image.png",
    contentType = "image/png",
    account = operator,
  ) {
    let uploadRequest = request(app.getHttpServer())
      .post(`/api/v1/catalog/products/manage/${targetProductId}/media`)
      .set("Cookie", account.cookie)
      .set("Origin", origin)
      .field("commandId", input.commandId)
      .field("altText", input.altText ?? "Front view of the garment")
      .field("reason", input.reason ?? "Add product media");
    if (input.variantId)
      uploadRequest = uploadRequest.field("variantId", input.variantId);
    return uploadRequest.attach("file", file, { filename, contentType });
  }

  function listMedia(targetProductId = productId, account = operator) {
    return request(app.getHttpServer())
      .get(`/api/v1/catalog/products/manage/${targetProductId}/media`)
      .set("Cookie", account.cookie)
      .expect("Cache-Control", "no-store");
  }

  function deleteMedia(id: string, reason: string, account = operator) {
    return request(app.getHttpServer())
      .delete(`/api/v1/catalog/products/manage/${productId}/media/${id}`)
      .set("Cookie", account.cookie)
      .set("Origin", origin)
      .send({ reason });
  }

  function storedObjectsFor(mediaId: string): number {
    return [...storage.objects.keys()].filter(
      (key) =>
        key === `quarantine/${mediaId}/source` ||
        key.startsWith(`published/${mediaId}/`),
    ).length;
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2Storage)
      .useValue(storage)
      .compile();
    app = module.createNestApplication({ bodyParser: false, logger: false });
    configureApp(app);
    await app.init();
    database = app.get(DatabaseService);
    operator = await createAccount("media-operator");
    customer = await createAccount("media-customer");
    recoveryManager = await createAccount("media-recovery-manager");
    await app.get(AccessService).bootstrapSuperadmin(operator.id, {
      reason: "Isolated media E2E operator",
    });
    await app
      .get(AccessService)
      .changeRole(operator, recoveryManager.id, "admin", "grant", {
        reason: "Allow recovery of pending media uploads",
      });
    productId = await createProduct("media-test-product");
    const [variant] = await database.db
      .select({ id: catalogProductVariant.id })
      .from(catalogProductVariant)
      .where(eq(catalogProductVariant.productId, productId))
      .limit(1);
    if (!variant)
      throw new Error("Media test product variant was not created.");
    variantId = variant.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("authorizes managers and validates the actual file content and product variant", async () => {
    const commandId = randomUUID();
    await listMedia(productId, customer).expect(403);
    await upload(
      productId,
      { commandId },
      png,
      "blocked.png",
      "image/png",
      customer,
    ).expect(403);
    expect(storage.objects.size).toBe(0);

    await upload(
      productId,
      { commandId: randomUUID() },
      Buffer.from("not an image"),
      "spoofed.png",
      "image/png",
    ).expect(400);

    await upload(
      productId,
      { commandId: randomUUID() },
      Buffer.alloc(MAX_CATALOG_MEDIA_UPLOAD_BYTES + 1),
      "too-large.png",
      "image/png",
    ).expect(413);
    expect((await listMedia()).body.media).toEqual([]);

    const otherProductId = await createProduct("media-other-product");
    await upload(otherProductId, {
      commandId: randomUUID(),
      variantId,
    }).expect(400);
    expect((await listMedia(otherProductId)).body.media).toEqual([]);
    expect(
      await database.db
        .select({ id: catalogProduct.id })
        .from(catalogProduct)
        .where(eq(catalogProduct.id, otherProductId)),
    ).toHaveLength(1);
  });

  it("lets another authorized manager recover an upload after R2 failure", async () => {
    const commandId = randomUUID();
    const input = { commandId, variantId };
    storage.failNextPut = true;

    const failed = await upload(productId, input).expect(503);
    expect(failed.body.errorCode).toBe("CATALOG_MEDIA_STORAGE_UNAVAILABLE");
    const pendingResponse = await listMedia().expect(200);
    expect(pendingResponse.body.media).toHaveLength(1);
    const pending = pendingResponse.body.media[0];
    expect(pending).toMatchObject({
      commandId,
      productId,
      variantId,
      reason: "Add product media",
      status: "uploading",
    });
    expect(pending).not.toHaveProperty("objectKey");
    expect(pending).not.toHaveProperty("sourceSha256");

    const uploaded = await upload(
      productId,
      input,
      png,
      "image.png",
      "image/png",
      recoveryManager,
    ).expect(201);
    expect(uploaded.body).toMatchObject({
      id: pending.id,
      commandId,
      status: "ready",
    });
    expect(uploaded.body).not.toHaveProperty("objectKey");
    expect(storedObjectsFor(uploaded.body.id as string)).toBe(2);

    const replay = await upload(productId, input).expect(201);
    expect(replay.body.id).toBe(uploaded.body.id);
    await upload(productId, {
      ...input,
      reason: "Reusing a command for different input",
    }).expect(409);

    const events = await database.db
      .select({ eventType: auditEvent.eventType })
      .from(auditEvent)
      .where(eq(auditEvent.subjectId, uploaded.body.id as string));
    expect(events.map(({ eventType }) => eventType).sort()).toEqual([
      "catalog.media_processing_started",
      "catalog.media_quarantined",
      "catalog.media_ready",
      "catalog.media_upload_started",
    ]);
  });

  it("processes concurrent uploads and bounds buffered requests per process", async () => {
    const started: Array<() => void> = [];
    const gates: Array<() => void> = [];
    const putStarted = [0, 1].map(
      () =>
        new Promise<void>((resolve) => {
          started.push(resolve);
        }),
    );
    const putGates = [0, 1].map(
      () =>
        new Promise<void>((resolve) => {
          gates.push(resolve);
        }),
    );
    storage.holdPuts = putStarted.map((_, index) => ({
      started: started[index]!,
      wait: putGates[index]!,
    }));

    const firstRequest = upload(productId, { commandId: randomUUID() }).then(
      (response) => response,
    );
    const secondRequest = upload(productId, { commandId: randomUUID() }).then(
      (response) => response,
    );

    try {
      await Promise.all(putStarted);
      const rejected = await upload(productId, {
        commandId: randomUUID(),
      }).expect(429);
      expect(rejected.body.errorCode).toBe("CATALOG_MEDIA_UPLOAD_BUSY");
    } finally {
      gates.forEach((release) => release());
    }

    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    expect(first.status).toBe(201);
    expect(first.body.status).toBe("ready");
    expect(second.status).toBe(201);
    expect(second.body.status).toBe("ready");

    const afterRelease = await upload(productId, {
      commandId: randomUUID(),
    }).expect(201);
    expect(afterRelease.body.status).toBe("ready");
  });

  it("recovers after the object write succeeds but the database completion fails", async () => {
    const commandId = randomUUID();
    const audit = app.get(AuditService);
    const append = audit.append.bind(audit);
    let failCompletion = true;
    const auditSpy = vi
      .spyOn(audit, "append")
      .mockImplementation((transaction, event) => {
        if (failCompletion && event.eventType === "catalog.media_quarantined") {
          failCompletion = false;
          throw new Error("simulated completion transaction failure");
        }
        return append(transaction, event);
      });

    try {
      await upload(productId, { commandId }).expect(500);
    } finally {
      auditSpy.mockRestore();
    }

    const pending = (await listMedia().expect(200)).body.media.find(
      (item: { commandId: string }) => item.commandId === commandId,
    );
    expect(pending).toMatchObject({ commandId, status: "uploading" });
    expect(storedObjectsFor(pending.id as string)).toBe(1);

    const recovered = await upload(productId, { commandId }).expect(201);
    expect(recovered.body).toMatchObject({
      id: pending.id,
      commandId,
      status: "ready",
    });
    expect(storedObjectsFor(pending.id as string)).toBe(2);
  });

  it("serves only hashed, processed derivatives for published products", async () => {
    const uploaded = await upload(productId, {
      commandId: randomUUID(),
    }).expect(201);
    expect(uploaded.body.status).toBe("ready");

    const [stored] = await database.db
      .select({ derivatives: catalogProductMedia.derivatives })
      .from(catalogProductMedia)
      .where(eq(catalogProductMedia.id, uploaded.body.id as string));
    const card = stored?.derivatives.find(
      (derivative) => derivative.rendition === "card",
    );
    if (!card) throw new Error("Processed media did not create a card image.");
    const imagePath = `/api/v1/catalog/media/${uploaded.body.id}/card/${card.sha256}.webp`;

    await request(app.getHttpServer()).get(imagePath).expect(404);

    await database.db
      .update(catalogProductVariant)
      .set({ priceBdt: 100 })
      .where(eq(catalogProductVariant.id, variantId));
    await database.db
      .update(catalogProduct)
      .set({ isPublished: true })
      .where(eq(catalogProduct.id, productId));

    const publicProduct = await request(app.getHttpServer())
      .get("/api/v1/catalog/products/media-test-product")
      .expect(200);
    const publicImage = publicProduct.body.images.find(
      (image: { id: string }) => image.id === uploaded.body.id,
    );
    expect(publicImage).toMatchObject({
      id: uploaded.body.id,
      card: { src: imagePath, width: 2, height: 3 },
    });

    const served = await request(app.getHttpServer())
      .get(imagePath)
      .expect(200)
      .expect("Content-Type", "image/webp")
      .expect("X-Content-Type-Options", "nosniff")
      .expect("Cache-Control", "private, no-store");
    expect(Buffer.isBuffer(served.body)).toBe(true);
    expect(served.body.subarray(0, 4).toString("hex")).toBe("52494646");

    await request(app.getHttpServer())
      .get(imagePath.replace(card.sha256, "0".repeat(64)))
      .expect(404);

    await database.db
      .update(catalogProduct)
      .set({ isPublished: false })
      .where(eq(catalogProduct.id, productId));
    await request(app.getHttpServer())
      .get(imagePath)
      .expect(404)
      .expect("Cache-Control", "private, no-store");

    await database.db
      .update(catalogProduct)
      .set({ isPublished: true })
      .where(eq(catalogProduct.id, productId));
    await deleteMedia(uploaded.body.id, "Remove outdated product photo").expect(
      204,
    );
    await request(app.getHttpServer())
      .get(imagePath)
      .expect(404)
      .expect("Cache-Control", "private, no-store");
  });

  it("keeps failed processing private and retries it with the same command", async () => {
    const commandId = randomUUID();
    const input = { commandId };
    storage.failNextDerivativePut = true;

    const failed = await upload(productId, input).expect(503);
    expect(failed.body.errorCode).toBe("CATALOG_MEDIA_STORAGE_UNAVAILABLE");
    const pending = (await listMedia().expect(200)).body.media.find(
      (item: { commandId: string }) => item.commandId === commandId,
    );
    expect(pending).toMatchObject({ commandId, status: "processing" });

    const [stored] = await database.db
      .select({ derivatives: catalogProductMedia.derivatives })
      .from(catalogProductMedia)
      .where(eq(catalogProductMedia.id, pending.id as string));
    const card = stored?.derivatives.find(
      (derivative) => derivative.rendition === "card",
    );
    if (!card) throw new Error("Pending processing has no manifest.");
    const imagePath = `/api/v1/catalog/media/${pending.id}/card/${card.sha256}.webp`;
    await request(app.getHttpServer()).get(imagePath).expect(404);

    const recovered = await upload(productId, input).expect(201);
    expect(recovered.body).toMatchObject({ id: pending.id, status: "ready" });
    expect(
      storage.objects.get(`published/${pending.id}/${card.sha256}.webp`),
    ).toBeDefined();
  });

  it("rejects a file with an accepted signature that cannot be decoded", async () => {
    const corrupt = Buffer.from(png.subarray(0, 36));
    const response = await upload(
      productId,
      { commandId: randomUUID() },
      corrupt,
      "corrupt.png",
      "image/png",
    ).expect(201);
    expect(response.body.status).toBe("rejected");
    expect(
      storage.objects.has(`published/${response.body.id}/invalid.webp`),
    ).toBe(false);
  });

  it("rejects animated WebP instead of publishing only its first frame", async () => {
    const brightFrame = Buffer.alloc(2 * 3 * 4, 255);
    const darkFrame = Buffer.alloc(2 * 3 * 4, 0);
    const animated = await sharp(Buffer.concat([brightFrame, darkFrame]), {
      raw: { width: 2, height: 6, channels: 4, pageHeight: 3 },
    })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();

    const response = await upload(
      productId,
      { commandId: randomUUID() },
      animated,
      "animated.webp",
      "image/webp",
    ).expect(201);

    expect(response.body.status).toBe("rejected");
    expect(storedObjectsFor(response.body.id as string)).toBe(1);
  });

  it("applies image orientation and removes source metadata from derivatives", async () => {
    const jpeg = await sharp(png)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const uploaded = await upload(
      productId,
      { commandId: randomUUID() },
      jpeg,
      "with-metadata.jpg",
      "image/jpeg",
    ).expect(201);
    expect(uploaded.body.status).toBe("ready");

    const [stored] = await database.db
      .select({ derivatives: catalogProductMedia.derivatives })
      .from(catalogProductMedia)
      .where(eq(catalogProductMedia.id, uploaded.body.id as string));
    for (const derivative of stored?.derivatives ?? []) {
      const body = storage.objects.get(
        `published/${uploaded.body.id}/${derivative.sha256}.webp`,
      );
      if (!body) throw new Error("Processed image derivative was not stored.");
      const metadata = await sharp(body).metadata();
      expect(metadata.orientation).toBeUndefined();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.iptc).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
    }
  });

  it("retries deletion without losing the original reason", async () => {
    const commandId = randomUUID();
    const uploaded = await upload(productId, { commandId }).expect(201);
    const deletionReason = "Remove outdated product photo";
    storage.failNextDelete = true;

    const failed = await deleteMedia(uploaded.body.id, deletionReason).expect(
      503,
    );
    expect(failed.body.errorCode).toBe("CATALOG_MEDIA_STORAGE_UNAVAILABLE");
    const pending = (await listMedia().expect(200)).body.media.find(
      (item: { id: string }) => item.id === uploaded.body.id,
    );
    expect(pending).toMatchObject({
      status: "deleting",
      deletionReason,
    });

    await deleteMedia(uploaded.body.id, deletionReason).expect(204);
    expect(
      (await listMedia().expect(200)).body.media.some(
        (item: { id: string }) => item.id === uploaded.body.id,
      ),
    ).toBe(false);
    expect(storedObjectsFor(uploaded.body.id as string)).toBe(0);
    const [deleted] = await database.db
      .select({ status: catalogProductMedia.status })
      .from(catalogProductMedia)
      .where(eq(catalogProductMedia.id, uploaded.body.id as string));
    expect(deleted?.status).toBe("deleted");
  });

  it("recovers deletion after object removal succeeds but database completion fails", async () => {
    const uploaded = await upload(productId, {
      commandId: randomUUID(),
    }).expect(201);
    const audit = app.get(AuditService);
    const append = audit.append.bind(audit);
    let failCompletion = true;
    const auditSpy = vi
      .spyOn(audit, "append")
      .mockImplementation((transaction, event) => {
        if (failCompletion && event.eventType === "catalog.media_deleted") {
          failCompletion = false;
          throw new Error("simulated deletion completion transaction failure");
        }
        return append(transaction, event);
      });

    try {
      await deleteMedia(
        uploaded.body.id,
        "Remove outdated product photo",
      ).expect(500);
    } finally {
      auditSpy.mockRestore();
    }

    const pending = (await listMedia().expect(200)).body.media.find(
      (item: { id: string }) => item.id === uploaded.body.id,
    );
    expect(pending).toMatchObject({
      id: uploaded.body.id,
      status: "deleting",
      deletionReason: "Remove outdated product photo",
    });
    expect(storedObjectsFor(uploaded.body.id as string)).toBe(0);

    await deleteMedia(uploaded.body.id, "Remove outdated product photo").expect(
      204,
    );
    expect(
      (await listMedia().expect(200)).body.media.some(
        (item: { id: string }) => item.id === uploaded.body.id,
      ),
    ).toBe(false);
    expect(storedObjectsFor(uploaded.body.id as string)).toBe(0);
  });
});
