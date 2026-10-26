import { createHash, randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
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
import {
  API_V1_BASE_PATH,
  DEFAULT_LIST_PAGE_SIZE,
  DEFAULT_PUBLIC_STOREFRONT_HEADER_LINKS,
  DEFAULT_STOREFRONT_HEADER_NAVIGATION_CONFIG,
} from "@aaraj/contracts";
import type {
  StorefrontBrandAssetKind,
  StorefrontHeaderNavigationItem,
} from "@aaraj/contracts";
import { auth } from "../src/auth/auth.js";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";
import { deriveCartCookieSigningSecret } from "../src/cart/cart-cookie.js";
import { catalogCategory } from "../src/catalog/catalog-schema.js";
import { AccessService } from "../src/platform/authorization/access.service.js";
import { AuditService } from "../src/platform/audit/audit.service.js";
import { auditEvent } from "../src/platform/audit/audit-schema.js";
import { DatabaseService } from "../src/platform/database/database.service.js";
import { R2Storage } from "../src/platform/storage/r2-storage.js";
import {
  storefrontBrandAsset,
  storefrontBannerAsset,
  storefrontBanner,
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
  linkedin: null,
};
const emptyFooterLinkGroups = { about: [], policies: [] };
const defaultHeaderNavigationConfig: StorefrontHeaderNavigationItem[] = [
  ...DEFAULT_STOREFRONT_HEADER_NAVIGATION_CONFIG,
];
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

  function reorderBanners(bannerIds: string[], account = admin) {
    return request(app.getHttpServer())
      .patch(`${API_V1_BASE_PATH}/storefront/manage/banners/order`)
      .set("Cookie", account.cookie)
      .set("Origin", origin)
      .send({ placement: "home_hero", bannerIds });
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
    await database.db.delete(storefrontBanner);
    await database.db.delete(storefrontBannerAsset);
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
      footerLinkGroups: emptyFooterLinkGroups,
      footerCategoryIds: [],
      homepageCategoriesEnabled: false,
      homepageCategoryIds: [],
      headerNavigation: defaultHeaderNavigationConfig,
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
      footerLinkGroups: emptyFooterLinkGroups,
      footerCategoryIds: [],
      homepageCategoriesEnabled: false,
      homepageCategoryIds: [],
      headerNavigation: DEFAULT_PUBLIC_STOREFRONT_HEADER_LINKS,
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
        footerLinkGroups: emptyFooterLinkGroups,
        footerCategoryIds: [],
        headerNavigation: defaultHeaderNavigationConfig,
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
      footerLinkGroups: emptyFooterLinkGroups,
      footerCategoryIds: [],
      homepageCategoriesEnabled: false,
      homepageCategoryIds: [],
      headerNavigation: defaultHeaderNavigationConfig,
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
      headerNavigation: defaultHeaderNavigationConfig,
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
          footerLinkGroups: {
            about: [{ label: "Contact us", href: "/contact" }],
            policies: [],
          },
          footerCategoryIds: [],
          headerNavigation: defaultHeaderNavigationConfig,
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
      footerLinkGroups: {
        about: [{ label: "Contact us", href: "/contact" }],
        policies: [],
      },
      footerCategoryIds: [],
      homepageCategoriesEnabled: false,
      homepageCategoryIds: [],
      headerNavigation: DEFAULT_PUBLIC_STOREFRONT_HEADER_LINKS,
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
          "footerLinkGroups",
        ],
      },
    });
    expect(JSON.stringify(events[0]?.metadata)).not.toContain(
      validUpdate.supportPhone,
    );
  });

  it("keeps category configuration in management settings and publishes active category links", async () => {
    const slug = `header-nav-${randomUUID().slice(0, 8)}`;
    const [category] = await database.db
      .insert(catalogCategory)
      .values({ name: "Header category", slug })
      .returning({ id: catalogCategory.id });
    expect(category).toBeDefined();

    const categoryConfiguration = {
      type: "category",
      categoryId: category!.id,
    } as const;
    const updateResponse = await update(admin, {
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
      socialLinks: emptySocialLinks,
      footerDescription: null,
      footerLinks: [],
      headerNavigation: [categoryConfiguration],
      expectedVersion: 1,
      reason: "Configure a category in storefront navigation",
    }).expect(200);
    expect(updateResponse.body.headerNavigation).toEqual([
      categoryConfiguration,
    ]);

    const managementResponse = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/manage/settings`)
      .set("Cookie", admin.cookie)
      .expect(200);
    expect(managementResponse.body.headerNavigation).toEqual([
      categoryConfiguration,
    ]);

    const publicResponse = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/settings`)
      .expect(200);
    expect(publicResponse.body.headerNavigation).toEqual([
      { label: "Header category", href: `/shop/categories/${slug}` },
    ]);
    expect(JSON.stringify(publicResponse.body.headerNavigation)).not.toContain(
      category!.id,
    );

    await database.db
      .update(catalogCategory)
      .set({ isActive: false })
      .where(eq(catalogCategory.id, category!.id));
    const inactiveCategoryResponse = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/settings`)
      .expect(200);
    expect(inactiveCategoryResponse.body.headerNavigation).toEqual([]);
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
        headerNavigation: defaultHeaderNavigationConfig,
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
      headerNavigation: defaultHeaderNavigationConfig,
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

  it("creates reusable banner records and publishes homepage carousel slides", async () => {
    const emptyPublicBanners = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/banners/home_hero`)
      .expect(200);
    expect(emptyPublicBanners.headers["cache-control"]).toContain(
      "s-maxage=60",
    );
    expect(emptyPublicBanners.body).toEqual({
      placement: "home_hero",
      banners: [],
    });

    await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/manage/banners`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/manage/banners`)
      .set("Cookie", customer.cookie)
      .expect(403);

    const initial = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/manage/banners`)
      .set("Cookie", admin.cookie)
      .expect(200);
    expect(initial.body).toEqual({
      banners: [],
      limit: DEFAULT_LIST_PAGE_SIZE,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    });

    const upload = request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/storefront/manage/banner-assets`)
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .field("commandId", randomUUID())
      .attach("file", png, {
        filename: "catalog-banner.png",
        contentType: "image/png",
      });
    const uploaded = await upload.expect(201);
    const asset = uploaded.body as {
      id: string;
      src: string;
      width: number;
      height: number;
    };
    expect(asset.src).toMatch(
      /^\/api\/v1\/storefront\/manage\/banner-assets\/[0-9a-f-]{36}\/[0-9a-f]{64}\.webp$/,
    );
    expect(asset.width).toBeGreaterThan(0);
    expect(asset.height).toBeGreaterThan(0);
    expect(storage.objects.size).toBe(1);

    await request(app.getHttpServer()).get(asset.src).expect(401);
    await request(app.getHttpServer())
      .get(asset.src)
      .set("Cookie", customer.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(asset.src)
      .set("Cookie", admin.cookie)
      .expect(200)
      .expect("Content-Type", "image/webp")
      .expect("Cache-Control", "no-store");
    await request(app.getHttpServer())
      .get(asset.src.replace("/manage/banner-assets/", "/banner-assets/"))
      .expect(404);

    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/storefront/manage/banners`)
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .send({
        name: "Seasonal banner",
        placement: "home_hero",
        active: true,
        desktopAssetId: asset.id,
        mobileAssetId: asset.id,
        altText: "",
        href: "/shop",
      })
      .expect(400);

    const published = await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/storefront/manage/banners`)
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .send({
        name: "Seasonal banner",
        placement: "home_hero",
        active: true,
        desktopAssetId: asset.id,
        mobileAssetId: asset.id,
        altText: "AARAJ seasonal collection",
        href: "/shop",
      })
      .expect(201);
    const bannerId = published.body.id as string;
    expect(published.body).toMatchObject({
      name: "Seasonal banner",
      placement: "home_hero",
      active: true,
      desktop: { id: asset.id },
      mobile: { id: asset.id },
      altText: "AARAJ seasonal collection",
      href: "/shop",
      version: 1,
    });

    const publicBanner = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/banners/home_hero`)
      .expect(200);
    expect(publicBanner.headers["cache-control"]).toContain("s-maxage=60");
    expect(publicBanner.body).toMatchObject({
      placement: "home_hero",
      banners: [
        {
          desktop: { id: asset.id },
          mobile: { id: asset.id },
          altText: "AARAJ seasonal collection",
          href: "/shop",
        },
      ],
    });
    const [releasedAsset] = await database.db
      .select()
      .from(storefrontBannerAsset)
      .where(eq(storefrontBannerAsset.id, asset.id));
    expect(releasedAsset?.publiclyReleasedAt).toBeInstanceOf(Date);
    const publicAsset = publicBanner.body.banners[0].desktop.src as string;
    await request(app.getHttpServer())
      .get(publicAsset)
      .expect(200)
      .expect("Content-Type", "image/webp")
      .expect("Cache-Control", "public, max-age=31536000, immutable");

    const updated = await request(app.getHttpServer())
      .put(`${API_V1_BASE_PATH}/storefront/manage/banners/${bannerId}`)
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .send({
        name: "Seasonal banner revised",
        placement: "home_hero",
        active: true,
        desktopAssetId: asset.id,
        mobileAssetId: asset.id,
        altText: "AARAJ seasonal collection",
        href: "/shop/products/summer",
        expectedVersion: 1,
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      name: "Seasonal banner revised",
      href: "/shop/products/summer",
      version: 2,
    });

    await request(app.getHttpServer())
      .put(`${API_V1_BASE_PATH}/storefront/manage/banners/${bannerId}`)
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .send({
        name: "Seasonal banner",
        placement: "home_hero",
        active: true,
        desktopAssetId: asset.id,
        mobileAssetId: null,
        altText: "Invalid URL",
        href: "javascript:alert(1)",
        expectedVersion: 1,
      })
      .expect(400);
    const stale = await request(app.getHttpServer())
      .put(`${API_V1_BASE_PATH}/storefront/manage/banners/${bannerId}`)
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .send({
        name: "Seasonal banner",
        placement: "home_hero",
        active: false,
        desktopAssetId: asset.id,
        mobileAssetId: null,
        altText: "AARAJ seasonal collection",
        href: null,
        expectedVersion: 1,
      })
      .expect(409);
    expect(stale.body.errorCode).toBe("STOREFRONT_BANNER_STALE");

    const secondUpload = await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/storefront/manage/banner-assets`)
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .field("commandId", randomUUID())
      .attach("file", png, {
        filename: "second-catalog-banner.png",
        contentType: "image/png",
      })
      .expect(201);
    const secondAsset = secondUpload.body as { id: string };
    const secondSlide = await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/storefront/manage/banners`)
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .send({
        name: "Replacement banner",
        placement: "home_hero",
        active: true,
        desktopAssetId: secondAsset.id,
        mobileAssetId: null,
        altText: "AARAJ new collection",
        href: null,
      })
      .expect(201);
    expect(secondSlide.body.active).toBe(true);
    const secondBannerId = secondSlide.body.id as string;

    await reorderBanners([bannerId, bannerId]).expect(400);
    await reorderBanners([bannerId]).expect(409);
    await reorderBanners([bannerId, secondBannerId], customer).expect(403);
    await reorderBanners([bannerId, secondBannerId]).expect(200);

    const managedOrder = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/manage/banners`)
      .set("Cookie", admin.cookie)
      .expect(200);
    expect(
      managedOrder.body.banners.map(({ id }: { id: string }) => id),
    ).toEqual([bannerId, secondBannerId]);

    const carousel = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/banners/home_hero`)
      .expect(200);
    expect(carousel.body.banners).toHaveLength(2);
    expect(
      carousel.body.banners.map(
        (banner: { altText: string }) => banner.altText,
      ),
    ).toEqual(["AARAJ seasonal collection", "AARAJ new collection"]);
    const reorderEvents = await database.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.eventType, "storefront.banners_reordered"));
    expect(reorderEvents).toHaveLength(1);
    expect(reorderEvents[0]).toMatchObject({
      actorType: "user",
      actorId: admin.id,
      subjectType: "storefront_banner",
      subjectId: bannerId,
      metadata: {
        placement: "home_hero",
        bannerIds: [bannerId, secondBannerId],
      },
    });
    const drafts = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/manage/banners?status=draft`)
      .set("Cookie", admin.cookie)
      .expect(200);
    expect(drafts.body.banners).toEqual([]);

    const uploadEvents = await database.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.eventType, "storefront.banner_asset_uploaded"));
    const bannerEvents = await database.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.eventType, "storefront.banner_created"));
    const updateEvents = await database.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.eventType, "storefront.banner_updated"));
    expect(uploadEvents).toHaveLength(2);
    expect(bannerEvents).toHaveLength(2);
    expect(updateEvents).toHaveLength(1);
    expect(uploadEvents[0]?.reason).toBeNull();

    await request(app.getHttpServer())
      .put(`${API_V1_BASE_PATH}/storefront/manage/banners/${bannerId}`)
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .send({
        name: "Seasonal banner revised",
        placement: "home_hero",
        active: false,
        desktopAssetId: asset.id,
        mobileAssetId: asset.id,
        altText: "AARAJ seasonal collection",
        href: "/shop/products/summer",
        expectedVersion: 2,
      })
      .expect(200);
    await request(app.getHttpServer())
      .get(publicAsset)
      .expect(200)
      .expect("Cache-Control", "public, max-age=31536000, immutable");
    expect(bannerEvents[0]?.reason).toBeNull();

    const paginationFixtures = Array.from({ length: 51 }, (_, index) => {
      const id = randomUUID();
      const sha256 = "a".repeat(64);
      return {
        id,
        commandId: randomUUID(),
        objectKey: `published/storefront/banner/${id}/${sha256}.webp`,
        sizeBytes: 1,
        sourceSha256: sha256,
        sha256,
        width: 1,
        height: 1,
        createdBy: admin.id,
        createdAt: new Date(Date.now() + (index + 1) * 1000),
      };
    });
    await database.db.insert(storefrontBannerAsset).values(paginationFixtures);

    const firstAssetPage = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/manage/banner-assets`)
      .set("Cookie", admin.cookie)
      .expect(200);
    expect(firstAssetPage.body.assets).toHaveLength(50);
    expect(firstAssetPage.body.nextCursor).toMatch(/^[0-9a-f-]{36}$/);

    const secondAssetPage = await request(app.getHttpServer())
      .get(
        `${API_V1_BASE_PATH}/storefront/manage/banner-assets?cursor=${firstAssetPage.body.nextCursor}`,
      )
      .set("Cookie", admin.cookie);
    expect(secondAssetPage.status, JSON.stringify(secondAssetPage.body)).toBe(
      200,
    );
    expect(secondAssetPage.body.nextCursor).toBeNull();
    const listedAssetIds = new Set([
      ...firstAssetPage.body.assets.map((listed: { id: string }) => listed.id),
      ...secondAssetPage.body.assets.map((listed: { id: string }) => listed.id),
    ]);
    expect(
      paginationFixtures.every((fixture) => listedAssetIds.has(fixture.id)),
    ).toBe(true);
    await database.db.delete(storefrontBannerAsset).where(
      inArray(
        storefrontBannerAsset.id,
        paginationFixtures.map((fixture) => fixture.id),
      ),
    );
  });
});
