import { createHash, randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { API_V1_BASE_PATH } from "@aaraj/contracts";
import type { StorefrontBrandAssetKind } from "@aaraj/contracts";
import { auth } from "../src/auth/auth.js";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";
import { deriveCartCookieSigningSecret } from "../src/cart/cart-cookie.js";
import { AccessService } from "../src/platform/authorization/access.service.js";
import { AuditService } from "../src/platform/audit/audit.service.js";
import { auditEvent } from "../src/platform/audit/audit-schema.js";
import { DatabaseService } from "../src/platform/database/database.service.js";
import { R2Storage } from "../src/platform/storage/r2-storage.js";
import {
  storefrontBrandAsset,
  storefrontConfiguration,
} from "../src/storefront/storefront-schema.js";

type Account = { id: string; email: string; cookie: string };
const origin = "http://localhost:3000";
const password = "aaraj-storefront-e2e-password-123";
const emptySocialLinks = {
  instagram: null,
  facebook: null,
  tiktok: null,
  youtube: null,
  x: null,
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWO4I+d2R86NAYUCAFJZB4Fg78ImAAAAAElFTkSuQmCC",
  "base64",
);

class MemoryR2Storage {
  readonly objects = new Map<string, Buffer>();

  async putPublishedObject(input: { key: string; body: Buffer }) {
    this.objects.set(input.key, Buffer.from(input.body));
  }

  async getPublishedObject(input: {
    key: string;
    sha256: string;
    sizeBytes: number;
  }) {
    const body = this.objects.get(input.key);
    if (
      !body ||
      body.byteLength !== input.sizeBytes ||
      createHash("sha256").update(body).digest("hex") !== input.sha256
    ) {
      throw new Error("missing test brand asset");
    }
    return Buffer.from(body);
  }

  async deleteObjects(keys: string[]) {
    for (const key of keys) this.objects.delete(key);
  }
}

describe("storefront settings", () => {
  let app: NestExpressApplication;
  let database: DatabaseService;
  let owner: Account;
  let admin: Account;
  let staff: Account;
  let customer: Account;
  const storage = new MemoryR2Storage();

  async function createAccount(name: string): Promise<Account> {
    const email = `${name}-${randomUUID()}@storefront-e2e.example`;
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

  function update(actor: Account, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .put(`${API_V1_BASE_PATH}/storefront/manage/settings`)
      .set("Cookie", actor.cookie)
      .set("Origin", origin)
      .send(body);
  }

  function uploadAsset(
    actor: Account,
    kind: StorefrontBrandAssetKind,
    file: Buffer,
    input: {
      commandId?: string;
      expectedVersion?: number;
      reason?: string;
    } = {},
  ) {
    return request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/storefront/manage/assets/${kind}`)
      .set("Cookie", actor.cookie)
      .set("Origin", origin)
      .field("commandId", input.commandId ?? randomUUID())
      .field("expectedVersion", String(input.expectedVersion ?? 1))
      .field("reason", input.reason ?? "Publish the storefront brand asset")
      .attach("file", file, {
        filename: `${kind}.png`,
        contentType: "image/png",
      });
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(R2Storage)
      .useValue(storage)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
      cookies: { secret: deriveCartCookieSigningSecret() },
    });
    configureApp(app);
    await app.init();
    database = app.get(DatabaseService);
    owner = await createAccount("owner");
    admin = await createAccount("admin");
    staff = await createAccount("staff");
    customer = await createAccount("customer");

    const access = app.get(AccessService);
    await access.bootstrapSuperadmin(owner.id, {
      reason: "Create storefront settings E2E owner",
    });
    await access.changeRole(owner, admin.id, "admin", "grant", {
      reason: "Grant storefront settings E2E administrator",
    });
    await access.changeRole(owner, staff.id, "staff", "grant", {
      reason: "Grant storefront settings E2E staff role",
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    storage.objects.clear();
    await database.db.update(storefrontConfiguration).set({
      siteName: "AARAJ",
      brandColor: "#7b2220",
      backgroundColor: "#fafafafa",
      seoTitle: null,
      seoDescription: null,
      socialImageAlt: null,
      announcementEnabled: false,
      announcementText: null,
      supportPhone: null,
      supportEmail: null,
      businessAddress: null,
      logoAssetId: null,
      brandIconAssetId: null,
      faviconAssetId: null,
      socialImageAssetId: null,
      socialLinks: {
        instagram: null,
        facebook: null,
        tiktok: null,
        youtube: null,
        x: null,
      },
      footerDescription: null,
      footerLinks: [],
      version: 1,
      updatedAt: null,
      updatedBy: null,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("publishes only safe settings and restricts audited changes to authorized admins", async () => {
    const publicResponse = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/settings`)
      .expect(200);
    expect(publicResponse.headers["cache-control"]).toBe("no-store");
    expect(publicResponse.body).toEqual({
      siteName: "AARAJ",
      brandColor: "#7b2220",
      backgroundColor: "#fafafafa",
      seoTitle: null,
      seoDescription: null,
      announcementEnabled: false,
      announcementText: null,
      supportPhone: null,
      supportEmail: null,
      businessAddress: null,
      logo: null,
      brandIcon: null,
      favicon: null,
      socialImage: null,
      socialImageAlt: null,
      socialLinks: emptySocialLinks,
      footerDescription: null,
      footerLinks: [],
    });

    await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/manage/settings`)
      .expect(401);
    for (const actor of [staff, customer]) {
      await request(app.getHttpServer())
        .get(`${API_V1_BASE_PATH}/storefront/manage/settings`)
        .set("Cookie", actor.cookie)
        .expect(403);
      await update(actor, {
        siteName: "Unauthorized store",
        brandColor: "#7b2220",
        backgroundColor: "#fafafafa",
        seoTitle: null,
        seoDescription: null,
        socialImageAlt: null,
        announcementEnabled: false,
        announcementText: null,
        supportPhone: null,
        supportEmail: null,
        businessAddress: null,
        socialLinks: emptySocialLinks,
        footerDescription: null,
        footerLinks: [],
        expectedVersion: 1,
        reason: "Try to change the storefront",
      }).expect(403);
    }

    const managementResponse = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/manage/settings`)
      .set("Cookie", admin.cookie)
      .expect(200);
    expect(managementResponse.headers["cache-control"]).toBe("no-store");
    expect(managementResponse.body).toEqual({
      siteName: "AARAJ",
      brandColor: "#7b2220",
      backgroundColor: "#fafafafa",
      seoTitle: null,
      seoDescription: null,
      announcementEnabled: false,
      announcementText: null,
      supportPhone: null,
      supportEmail: null,
      businessAddress: null,
      logo: null,
      brandIcon: null,
      favicon: null,
      socialImage: null,
      socialImageAlt: null,
      socialLinks: emptySocialLinks,
      footerDescription: null,
      footerLinks: [],
      version: 1,
      updatedAt: null,
    });

    const validUpdate = {
      siteName: "AARAJ Festive Edit",
      brandColor: "#8c2b2b",
      backgroundColor: "#f8f8f8fa",
      seoTitle: "AARAJ Festive Edit | Modern fashion",
      seoDescription: "Explore the latest AARAJ collection in Bangladesh.",
      socialImageAlt: "AARAJ seasonal collection against a warm background",
      announcementEnabled: true,
      announcementText: "Step into the festive season with AARAJ",
      supportPhone: "+8801712345678",
      supportEmail: "help@aaraj.example",
      businessAddress: "Dhaka, Bangladesh",
      socialLinks: {
        ...emptySocialLinks,
        instagram: "https://instagram.com/aaraj",
      },
      footerDescription: "Everyday style, thoughtfully selected.",
      footerLinks: [{ label: "Contact us", href: "/contact" }],
      expectedVersion: 1,
      reason: "Publish the festive storefront update",
    };
    await update(admin, {
      ...validUpdate,
      announcementText: null,
    }).expect(400);
    await update(admin, {
      ...validUpdate,
      internalSecret: "must be rejected",
    }).expect(400);
    await update(admin, {
      ...validUpdate,
      backgroundColor: "var(--background)",
    }).expect(400);

    await update(admin, validUpdate)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          siteName: "AARAJ Festive Edit",
          brandColor: "#8c2b2b",
          backgroundColor: "#f8f8f8fa",
          seoTitle: "AARAJ Festive Edit | Modern fashion",
          seoDescription: "Explore the latest AARAJ collection in Bangladesh.",
          socialImageAlt: "AARAJ seasonal collection against a warm background",
          announcementEnabled: true,
          announcementText: "Step into the festive season with AARAJ",
          supportPhone: "+8801712345678",
          supportEmail: "help@aaraj.example",
          businessAddress: "Dhaka, Bangladesh",
          socialLinks: {
            ...emptySocialLinks,
            instagram: "https://instagram.com/aaraj",
          },
          footerDescription: "Everyday style, thoughtfully selected.",
          footerLinks: [{ label: "Contact us", href: "/contact" }],
          version: 2,
        });
        expect(body).not.toHaveProperty("updatedBy");
      });

    const updatedPublicSettings = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/settings`)
      .expect(200);
    expect(updatedPublicSettings.body).toEqual({
      siteName: "AARAJ Festive Edit",
      brandColor: "#8c2b2b",
      backgroundColor: "#f8f8f8fa",
      seoTitle: "AARAJ Festive Edit | Modern fashion",
      seoDescription: "Explore the latest AARAJ collection in Bangladesh.",
      socialImageAlt: "AARAJ seasonal collection against a warm background",
      announcementEnabled: true,
      announcementText: "Step into the festive season with AARAJ",
      supportPhone: "+8801712345678",
      supportEmail: "help@aaraj.example",
      businessAddress: "Dhaka, Bangladesh",
      logo: null,
      brandIcon: null,
      favicon: null,
      socialImage: null,
      socialLinks: {
        ...emptySocialLinks,
        instagram: "https://instagram.com/aaraj",
      },
      footerDescription: "Everyday style, thoughtfully selected.",
      footerLinks: [{ label: "Contact us", href: "/contact" }],
    });
    expect(updatedPublicSettings.body).not.toHaveProperty("version");
    expect(updatedPublicSettings.body).not.toHaveProperty("updatedAt");

    const staleResponse = await update(admin, {
      ...validUpdate,
      siteName: "Stale overwrite",
    }).expect(409);
    expect(staleResponse.body.errorCode).toBe("STOREFRONT_SETTINGS_STALE");

    const events = await database.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.eventType, "storefront.settings_updated"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorType: "user",
      actorId: admin.id,
      subjectType: "storefront_configuration",
      subjectId: "default",
      reason: validUpdate.reason,
      metadata: {
        previousVersion: 1,
        version: 2,
        changedFields: [
          "siteName",
          "brandColor",
          "backgroundColor",
          "seoTitle",
          "seoDescription",
          "socialImageAlt",
          "announcementEnabled",
          "announcementText",
          "supportPhone",
          "supportEmail",
          "businessAddress",
          "socialLinks",
          "footerDescription",
          "footerLinks",
        ],
      },
    });
    expect(JSON.stringify(events[0]?.metadata)).not.toContain(
      validUpdate.supportPhone,
    );
  });

  it("rejects untrusted mutation origins and rolls back an update if audit writing fails", async () => {
    await request(app.getHttpServer())
      .put(`${API_V1_BASE_PATH}/storefront/manage/settings`)
      .set("Cookie", admin.cookie)
      .send({
        siteName: "Origin blocked",
        brandColor: "#7b2220",
        backgroundColor: "#fafafafa",
        seoTitle: null,
        seoDescription: null,
        socialImageAlt: null,
        announcementEnabled: false,
        announcementText: null,
        supportPhone: null,
        supportEmail: null,
        businessAddress: null,
        socialLinks: emptySocialLinks,
        footerDescription: null,
        footerLinks: [],
        expectedVersion: 1,
        reason: "Test origin protection",
      })
      .expect(403);

    vi.spyOn(app.get(AuditService), "append").mockRejectedValueOnce(
      new Error("Audit unavailable"),
    );
    await update(admin, {
      siteName: "Must roll back",
      brandColor: "#7b2220",
      backgroundColor: "#fafafafa",
      seoTitle: null,
      seoDescription: null,
      socialImageAlt: null,
      announcementEnabled: false,
      announcementText: null,
      supportPhone: null,
      supportEmail: null,
      businessAddress: null,
      socialLinks: emptySocialLinks,
      footerDescription: null,
      footerLinks: [],
      expectedVersion: 1,
      reason: "Test audit transaction rollback",
    }).expect(500);

    const [stored] = await database.db.select().from(storefrontConfiguration);
    expect(stored).toMatchObject({
      id: "default",
      siteName: "AARAJ",
      brandColor: "#7b2220",
      backgroundColor: "#fafafafa",
      version: 1,
      updatedBy: null,
    });
  });

  it("authorizes, normalizes, publishes, and clears immutable brand assets", async () => {
    const before = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/settings`)
      .expect(200);
    expect(before.body.logo).toBeNull();
    expect(before.body.brandIcon).toBeNull();

    await uploadAsset(staff, "logo", png).expect(403);
    expect(storage.objects.size).toBe(0);

    const logoCommandId = randomUUID();
    const afterLogo = await uploadAsset(admin, "logo", png, {
      commandId: logoCommandId,
      expectedVersion: 1,
      reason: "Publish the store logo",
    }).expect(201);
    expect(afterLogo.body).toMatchObject({
      version: 2,
      logo: {
        contentType: "image/webp",
        width: 2,
        height: 3,
      },
      favicon: null,
      brandIcon: null,
    });
    expect(afterLogo.body.logo.src).toMatch(
      /^\/api\/v1\/storefront\/assets\/[0-9a-f-]{36}\/[0-9a-f]{64}\.webp$/,
    );
    expect(storage.objects.size).toBe(1);

    const duplicate = await uploadAsset(admin, "logo", png, {
      commandId: logoCommandId,
      expectedVersion: 1,
      reason: "Retry the same store logo command",
    }).expect(201);
    expect(duplicate.body.version).toBe(2);
    expect(duplicate.body.logo).toEqual(afterLogo.body.logo);
    expect(storage.objects.size).toBe(1);

    const logoResponse = await request(app.getHttpServer())
      .get(afterLogo.body.logo.src)
      .expect(200);
    expect(logoResponse.headers["content-type"]).toContain("image/webp");
    expect(logoResponse.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(logoResponse.headers["x-content-type-options"]).toBe("nosniff");

    const iconAssetResponse = await request(app.getHttpServer())
      .get(`${afterLogo.body.logo.src}?format=png`)
      .expect(200);
    expect(iconAssetResponse.headers["content-type"]).toContain("image/png");

    const afterFavicon = await uploadAsset(admin, "favicon", png, {
      expectedVersion: 2,
      reason: "Publish the store favicon",
    }).expect(201);
    expect(afterFavicon.body).toMatchObject({
      version: 3,
      favicon: { contentType: "image/png", width: 64, height: 64 },
    });
    const faviconResponse = await request(app.getHttpServer())
      .get(afterFavicon.body.favicon.src)
      .expect(200);
    expect(faviconResponse.headers["content-type"]).toContain("image/png");

    const afterBrandIcon = await uploadAsset(admin, "brandIcon", png, {
      expectedVersion: 3,
      reason: "Publish the square brand icon",
    }).expect(201);
    expect(afterBrandIcon.body).toMatchObject({
      version: 4,
      brandIcon: {
        contentType: "image/png",
        width: 1024,
        height: 1024,
      },
    });
    expect(afterBrandIcon.body.brandIcon.src).toMatch(
      /^\/api\/v1\/storefront\/assets\/[0-9a-f-]{36}\/[0-9a-f]{64}\.png$/,
    );
    const brandIconResponse = await request(app.getHttpServer())
      .get(afterBrandIcon.body.brandIcon.src)
      .expect(200);
    expect(brandIconResponse.headers["content-type"]).toContain("image/png");

    const afterSocialImage = await uploadAsset(admin, "socialImage", png, {
      expectedVersion: 4,
      reason: "Publish the default social sharing image",
    }).expect(201);
    expect(afterSocialImage.body).toMatchObject({
      version: 5,
      socialImage: {
        contentType: "image/jpeg",
        width: 1200,
        height: 630,
      },
    });
    expect(afterSocialImage.body.socialImage.src).toMatch(
      /^\/api\/v1\/storefront\/assets\/[0-9a-f-]{36}\/[0-9a-f]{64}\.jpg$/,
    );
    const socialImageResponse = await request(app.getHttpServer())
      .get(afterSocialImage.body.socialImage.src)
      .expect(200);
    expect(socialImageResponse.headers["content-type"]).toContain("image/jpeg");

    const cleared = await request(app.getHttpServer())
      .delete(`${API_V1_BASE_PATH}/storefront/manage/assets/logo`)
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .send({ expectedVersion: 5, reason: "Remove the old store logo" })
      .expect(200);
    expect(cleared.body).toMatchObject({ version: 6, logo: null });
    await request(app.getHttpServer()).get(afterLogo.body.logo.src).expect(404);
    await request(app.getHttpServer())
      .get(afterSocialImage.body.socialImage.src)
      .expect(200);

    const clearedBrandIcon = await request(app.getHttpServer())
      .delete(`${API_V1_BASE_PATH}/storefront/manage/assets/brandIcon`)
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .send({
        expectedVersion: 6,
        reason: "Remove the old square brand icon",
      })
      .expect(200);
    expect(clearedBrandIcon.body).toMatchObject({
      version: 7,
      brandIcon: null,
    });
    await request(app.getHttpServer())
      .get(afterBrandIcon.body.brandIcon.src)
      .expect(404);

    const clearedSocialImage = await request(app.getHttpServer())
      .delete(`${API_V1_BASE_PATH}/storefront/manage/assets/socialImage`)
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .send({
        expectedVersion: 7,
        reason: "Remove the old social sharing image",
      })
      .expect(200);
    expect(clearedSocialImage.body).toMatchObject({
      version: 8,
      socialImage: null,
    });
    await request(app.getHttpServer())
      .get(afterSocialImage.body.socialImage.src)
      .expect(404);
    expect(storage.objects.size).toBe(4);

    const events = await database.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.subjectType, "storefront_configuration"));
    expect(
      events.filter((event) =>
        event.eventType.startsWith("storefront.brand_asset_"),
      ),
    ).toHaveLength(7);
    expect(events.map((event) => event.reason)).toEqual(
      expect.arrayContaining([
        "Publish the store logo",
        "Publish the store favicon",
        "Publish the square brand icon",
        "Remove the old store logo",
        "Remove the old square brand icon",
        "Publish the default social sharing image",
        "Remove the old social sharing image",
      ]),
    );
  });

  it("rejects spoofed, invalid, and stale image uploads without retaining objects", async () => {
    const assetsBefore = await database.db.select().from(storefrontBrandAsset);
    const spoofed = Buffer.from("this is not a PNG image");
    await uploadAsset(admin, "logo", spoofed).expect(400);
    await uploadAsset(admin, "logo", png, {
      expectedVersion: 2,
      reason: "Try to publish with stale settings",
    }).expect(409);
    expect(storage.objects.size).toBe(0);
    const [configuration] = await database.db
      .select()
      .from(storefrontConfiguration);
    expect(configuration).toMatchObject({
      version: 1,
      logoAssetId: null,
      brandIconAssetId: null,
    });
    const assets = await database.db.select().from(storefrontBrandAsset);
    expect(assets).toHaveLength(assetsBefore.length);
  });

  it("removes the uploaded object when the asset audit transaction fails", async () => {
    const assetsBefore = await database.db.select().from(storefrontBrandAsset);
    vi.spyOn(app.get(AuditService), "append").mockRejectedValueOnce(
      new Error("Audit unavailable"),
    );
    await uploadAsset(admin, "logo", png, {
      expectedVersion: 1,
      reason: "Test brand asset transaction rollback",
    }).expect(500);

    expect(storage.objects.size).toBe(0);
    const [configuration] = await database.db
      .select()
      .from(storefrontConfiguration);
    expect(configuration).toMatchObject({
      version: 1,
      logoAssetId: null,
      brandIconAssetId: null,
    });
    const assets = await database.db.select().from(storefrontBrandAsset);
    expect(assets).toHaveLength(assetsBefore.length);
  });
});
