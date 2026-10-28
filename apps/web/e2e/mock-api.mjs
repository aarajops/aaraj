import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import {
  CatalogProductCreateSchema,
  CatalogProductSlugSuggestionQuerySchema,
  CatalogPublishedProductListQuerySchema,
  CatalogProductUpdateSchema,
  CatalogSizeGuideCreateSchema,
  CatalogCategoryCreateSchema,
  CatalogCategoryManagementListQuerySchema,
  CatalogCategorySlugSuggestionQuerySchema,
  CatalogCategoryUpdateSchema,
  CATALOG_CATEGORY_SLUG_MAX_LENGTH,
  CATALOG_PRODUCT_SLUG_MAX_LENGTH,
  InventoryListQuerySchema,
  OrderListQuerySchema,
  PathaoManagementBookingSummariesQuerySchema,
  PathaoManagementIssuesQuerySchema,
  AccessUserListQuerySchema,
  StorefrontBannerListQuerySchema,
  DEFAULT_LIST_PAGE_SIZE,
  DEFAULT_PUBLIC_STOREFRONT_HEADER_LINKS,
  MAX_LIST_OFFSET,
  MAX_LIST_PAGE_SIZE,
} from "@aaraj/contracts";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3181);
const products = [];
const publicStorefrontSettings = {
  siteName: "Aaraj",
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
  socialLinks: {
    instagram: null,
    facebook: null,
    tiktok: null,
    youtube: null,
    x: null,
    linkedin: null,
  },
  headerNavigation: [...DEFAULT_PUBLIC_STOREFRONT_HEADER_LINKS],
  footerDescription: null,
  footerLinks: [],
  footerLinkGroups: { about: [], policies: [] },
  footerCategoryIds: [],
};
const clothingCategory = makeCategory("Clothing", "clothing");
const tshirtCategory = makeCategory(
  "T-shirts",
  "t-shirts",
  clothingCategory.id,
);
const sweatwearCategory = makeCategory("Sweatwear", "sweatwear");
const categories = [clothingCategory, tshirtCategory, sweatwearCategory];
const sizeGuides = Array.from({ length: 100 }, (_, index) =>
  makeGuide(
    {
      name:
        index === 0
          ? "Legacy guide beyond the first page"
          : `Historical guide ${index + 1}`,
      category: tshirtCategory,
      fit: index === 0 ? "Regular" : null,
      measurementBasis: "garment",
      rows: [
        {
          sizeLabel: index === 0 ? "S" : "M",
          measurements: [{ key: "chest_width", value: "19.7" }],
        },
      ],
    },
    new Date(Date.UTC(2020, 0, index + 1)).toISOString(),
  ),
);
const managedOrders = Array.from({ length: 73 }, (_, index) => {
  const sequence = index + 1;
  const status = ["awaiting_confirmation", "confirmed", "rejected"][index % 3];
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    reference: `ORD-026-${String(sequence).padStart(5, "0")}`,
    customerName: "E2E Order Customer",
    customerPhone: "+8801712345678",
    deliveryZone: ["inside_dhaka", "suburban", "outside_dhaka"][index % 3],
    items: [
      {
        productName: "E2E Order Item",
        color: "Black",
        sizeLabel: "M",
        quantity: (index % 3) + 1,
      },
    ],
    status,
    fulfillmentStatus:
      status === "confirmed"
        ? "awaiting_dispatch"
        : status === "rejected"
          ? "cancelled"
          : "not_started",
    collectionStatus: "uncollected",
    codAmountDueBdt: 1000 + sequence,
    deliveryProvider: null,
    createdAt: new Date(
      Date.UTC(2026, 9, 1, 12, 0, 0) - index * 60_000,
    ).toISOString(),
  };
});
const managedUsers = [
  {
    id: "e2e-staff-user",
    name: "E2E Staff User",
    email: "staff@example.test",
    emailVerified: true,
    createdAt: "2026-09-01T12:00:00.000Z",
    roles: ["staff"],
  },
];
const managedStorefrontBanners = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    name: "E2E homepage banner",
    placement: "home_hero",
    active: false,
    desktop: null,
    mobile: null,
    altText: "",
    href: null,
    version: 1,
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: null,
  },
];
const managedDeliveryIssues = [
  {
    id: "00000000-0000-4000-8000-000000000201",
    orderId: null,
    orderReference: null,
    consignmentId: null,
    merchantOrderId: null,
    storeId: null,
    event: "shipment_created",
    providerStatus: null,
    status: "unmatched",
    errorCode: null,
    occurredAt: "2026-10-01T12:00:00.000Z",
  },
];
const managedRoleCatalog = [
  {
    role: "admin",
    permissions: [
      "access.read_self",
      "access.read",
      "access.manage",
      "audit.read",
      "catalog.manage",
      "catalog.categories.manage",
      "inventory.manage",
      "orders.manage",
      "delivery.tariff.manage",
      "storefront.settings.manage",
    ],
  },
  {
    role: "staff",
    permissions: [
      "access.read_self",
      "catalog.manage",
      "inventory.manage",
      "orders.manage",
    ],
  },
  { role: "moderator", permissions: ["access.read_self", "audit.read"] },
  {
    role: "superadmin",
    permissions: [
      "access.read_self",
      "access.read",
      "access.manage",
      "audit.read",
      "catalog.manage",
      "catalog.categories.manage",
      "inventory.manage",
      "orders.manage",
      "delivery.tariff.manage",
      "storefront.settings.manage",
    ],
  },
];
const managedInventory = [
  {
    id: "6bc2deaf-5b52-4c6d-8a15-000000000001",
    sku: "AA-TEE-BLK-S",
    productName: "Aaraj Classic Tee",
    color: "Black",
    sizeLabel: "S",
    quantityOnHand: 24,
    quantityReserved: 3,
    quantityAvailable: 21,
    stockUpdatedAt: "2026-10-01T12:00:00.000Z",
  },
  {
    id: "6bc2deaf-5b52-4c6d-8a15-000000000002",
    sku: "AA-TEE-BLK-M",
    productName: "Aaraj Classic Tee",
    color: "Black",
    sizeLabel: "M",
    quantityOnHand: 18,
    quantityReserved: 2,
    quantityAvailable: 16,
    stockUpdatedAt: "2026-10-02T12:00:00.000Z",
  },
  {
    id: "6bc2deaf-5b52-4c6d-8a15-000000000003",
    sku: "AA-HOODIE-GRY-M",
    productName: "Aaraj Essential Hoodie",
    color: "Grey",
    sizeLabel: "M",
    quantityOnHand: 0,
    quantityReserved: 0,
    quantityAvailable: 0,
    stockUpdatedAt: null,
  },
];
const mediaFixtureId = "a2c3f2f8-1a15-4c64-a1cb-902b30443dc2";
const mediaFixtureBytes = Buffer.from(
  "UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAdQjyIXpf+BiOh/AAA=",
  "base64",
);
const mediaFixtureSha256 = createHash("sha256")
  .update(mediaFixtureBytes)
  .digest("hex");
const mediaFixturePath = `/api/v1/catalog/media/${mediaFixtureId}/detail/${mediaFixtureSha256}.webp`;
const mediaFixtureCardPath = mediaFixturePath.replace("/detail/", "/card/");
const mediaFixtureProduct = {
  id: "6bdb0de0-08da-497d-8c95-173875a9eaa5",
  slug: "media-e2e-fixture",
  name: "Media E2E fixture",
  description: "A storefront image delivery fixture.",
  audience: "unisex",
  category: null,
  fit: null,
  fabricComposition: null,
  careInstructions: null,
  sizeGuideId: null,
  price: null,
  isPublished: true,
  createdAt: "2026-10-07T00:00:00.000Z",
  updatedAt: "2026-10-07T00:00:00.000Z",
  images: [
    {
      id: mediaFixtureId,
      variantId: null,
      altText: "A one-pixel product image used to verify media delivery.",
      card: {
        src: mediaFixtureCardPath,
        width: 1,
        height: 1,
      },
      detail: { src: mediaFixturePath, width: 1, height: 1 },
    },
    {
      id: "b3d4f309-2b26-5d75-b2c3-a2d9db5e4ed3",
      variantId: null,
      altText: "Secondary media fixture",
      card: {
        src: mediaFixtureCardPath,
        width: 1,
        height: 1,
      },
      detail: { src: mediaFixturePath, width: 1, height: 1 },
    },
  ],
  variants: [],
  sizeGuide: null,
};

function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function roleFromCookie(cookie = "") {
  const token = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("aaraj-e2e-role="));
  return token?.slice("aaraj-e2e-role=".length) ?? null;
}

function requireStaff(request, response) {
  const role = roleFromCookie(request.headers.cookie);
  if (["staff", "admin", "superadmin"].includes(role)) return true;
  send(response, role ? 403 : 401, {
    statusCode: role ? 403 : 401,
    message: role ? "Forbidden" : "Unauthorized",
  });
  return false;
}

function requireCategoryAdmin(request, response) {
  const role = roleFromCookie(request.headers.cookie);
  if (role === "admin" || role === "superadmin") return true;
  send(response, role ? 403 : 401, {
    statusCode: role ? 403 : 401,
    message: role ? "Forbidden" : "Unauthorized",
  });
  return false;
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

const heldApiPaths = new Set();
const heldApiWaiters = new Map();

function holdApiResponse(path) {
  if (!heldApiPaths.has(path)) return Promise.resolve();
  return new Promise((resolve) => {
    const waiters = heldApiWaiters.get(path) ?? [];
    waiters.push(resolve);
    heldApiWaiters.set(path, waiters);
  });
}

function releaseApiResponse(path) {
  heldApiPaths.delete(path);
  for (const resolve of heldApiWaiters.get(path) ?? []) resolve();
  heldApiWaiters.delete(path);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  const method = request.method ?? "GET";
  if (url.pathname === "/__e2e/response-gate" && method === "POST") {
    const body = await readBody(request);
    if (
      !body ||
      typeof body.path !== "string" ||
      !body.path.startsWith("/api/") ||
      !["hold", "release"].includes(body.action)
    ) {
      send(response, 400, {
        statusCode: 400,
        message: "Invalid response gate",
      });
      return;
    }
    if (body.action === "hold") heldApiPaths.add(body.path);
    else releaseApiResponse(body.path);
    send(response, 200, { status: body.action });
    return;
  }
  await holdApiResponse(url.pathname);
  if (url.pathname === "/api/health/ready") {
    send(response, 200, { status: "ok", database: "ok", redis: "ok" });
    return;
  }
  if (url.pathname === "/api/v1/storefront/settings" && method === "GET") {
    send(response, 200, publicStorefrontSettings);
    return;
  }
  if (url.pathname === "/api/auth/get-session") {
    send(response, 200, null);
    return;
  }
  if (url.pathname === "/api/v1/access/me" && method === "GET") {
    const requestedRole = roleFromCookie(request.headers.cookie);
    if (!requestedRole) {
      send(response, 401, { statusCode: 401, message: "Unauthorized" });
      return;
    }

    const role = requestedRole;
    const permissions = ["access.read_self"];
    if (["staff", "admin", "superadmin"].includes(role)) {
      permissions.push("catalog.manage");
      permissions.push("orders.manage", "inventory.manage");
    }
    if (["admin", "superadmin"].includes(role)) {
      permissions.push("access.read", "access.manage", "audit.read");
      permissions.push("catalog.categories.manage");
      permissions.push("storefront.settings.manage");
    }
    send(response, 200, {
      userId: "aaraj-e2e-user",
      roles: [role],
      permissions,
    });
    return;
  }

  if (url.pathname === "/api/v1/access/users" && method === "GET") {
    if (!requireCategoryAdmin(request, response)) return;
    const parsed = AccessUserListQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!parsed.success) {
      send(response, 400, {
        statusCode: 400,
        message: "Invalid user pagination query",
      });
      return;
    }
    const matchingUsers = parsed.data.search
      ? managedUsers.filter((user) =>
          [user.name, user.email]
            .join(" ")
            .toLowerCase()
            .includes(parsed.data.search.toLowerCase()),
        )
      : managedUsers;
    const users = matchingUsers.slice(
      parsed.data.offset,
      parsed.data.offset + parsed.data.limit,
    );
    const hasMore = parsed.data.offset + users.length < matchingUsers.length;
    send(response, 200, {
      users,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      hasMore,
      nextOffset: hasMore ? parsed.data.offset + users.length : null,
    });
    return;
  }

  if (url.pathname === "/api/v1/access/roles" && method === "GET") {
    if (!requireCategoryAdmin(request, response)) return;
    send(response, 200, managedRoleCatalog);
    return;
  }

  if (
    url.pathname === "/api/v1/storefront/manage/banners" &&
    method === "GET"
  ) {
    if (!requireCategoryAdmin(request, response)) return;
    const parsed = StorefrontBannerListQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!parsed.success) {
      send(response, 400, {
        statusCode: 400,
        message: "Invalid banner pagination query",
      });
      return;
    }
    const matchingBanners = managedStorefrontBanners.filter((banner) => {
      if (
        parsed.data.status &&
        banner.active !== (parsed.data.status === "active")
      ) {
        return false;
      }
      return (
        !parsed.data.search ||
        [banner.name, banner.altText]
          .join(" ")
          .toLowerCase()
          .includes(parsed.data.search.toLowerCase())
      );
    });
    const banners = matchingBanners.slice(
      parsed.data.offset,
      parsed.data.offset + parsed.data.limit,
    );
    const hasMore =
      parsed.data.offset + banners.length < matchingBanners.length;
    send(response, 200, {
      banners,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      hasMore,
      nextOffset: hasMore ? parsed.data.offset + banners.length : null,
    });
    return;
  }

  if (
    url.pathname === "/api/v1/storefront/manage/banner-assets" &&
    method === "GET"
  ) {
    if (!requireCategoryAdmin(request, response)) return;
    send(response, 200, { assets: [], nextCursor: null });
    return;
  }

  if (url.pathname === "/api/v1/inventory/manage" && method === "GET") {
    if (!requireStaff(request, response)) return;
    const searches = url.searchParams.getAll("search");
    const parsed = InventoryListQuerySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
      search: searches.length > 1 ? searches : searches[0],
    });
    if (!parsed.success) {
      send(response, 400, {
        statusCode: 400,
        message: "Invalid Inventory list query",
      });
      return;
    }
    const matching = parsed.data.search
      ? managedInventory.filter((variant) =>
          [variant.productName, variant.sku, variant.color, variant.sizeLabel]
            .join(" ")
            .toLowerCase()
            .includes(parsed.data.search.toLowerCase()),
        )
      : managedInventory;
    const rows = matching.slice(
      parsed.data.offset,
      parsed.data.offset + parsed.data.limit + 1,
    );
    const hasMore = rows.length > parsed.data.limit;
    const pageRows = rows.slice(0, parsed.data.limit);
    const candidateNextOffset = parsed.data.offset + pageRows.length;
    send(response, 200, {
      variants: pageRows,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      hasMore,
      nextOffset:
        hasMore && candidateNextOffset <= MAX_LIST_OFFSET
          ? candidateNextOffset
          : null,
    });
    return;
  }

  if (url.pathname === "/api/v1/orders/manage" && method === "GET") {
    if (!requireStaff(request, response)) return;
    const searches = url.searchParams.getAll("search");
    const parsed = OrderListQuerySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
      search: searches.length > 1 ? searches : searches[0],
    });
    if (!parsed.success) {
      send(response, 400, {
        statusCode: 400,
        message: "Invalid Order list query",
      });
      return;
    }
    if (parsed.data.search === "ORD-026-99999") {
      send(response, 503, {
        statusCode: 503,
        message: "Synthetic Order list outage",
      });
      return;
    }
    const matching = parsed.data.search
      ? managedOrders.filter(({ reference }) =>
          reference.toLowerCase().includes(parsed.data.search.toLowerCase()),
        )
      : managedOrders;
    const rows = matching.slice(
      parsed.data.offset,
      parsed.data.offset + parsed.data.limit + 1,
    );
    const hasMore = rows.length > parsed.data.limit;
    const pageRows = rows.slice(0, parsed.data.limit);
    const candidateNextOffset = parsed.data.offset + pageRows.length;
    send(response, 200, {
      rows: pageRows,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      hasMore,
      nextOffset:
        hasMore && candidateNextOffset <= MAX_LIST_OFFSET
          ? candidateNextOffset
          : null,
    });
    return;
  }

  if (
    url.pathname === "/api/v1/delivery/pathao/manage/orders" &&
    method === "GET"
  ) {
    if (!requireStaff(request, response)) return;
    const parsed = PathaoManagementBookingSummariesQuerySchema.safeParse({
      orderIds: url.searchParams.get("orderIds") ?? undefined,
    });
    if (!parsed.success) {
      send(response, 400, {
        statusCode: 400,
        message: "Invalid Pathao order summary query",
      });
      return;
    }
    send(
      response,
      200,
      parsed.data.orderIds.map((orderId) => ({
        orderId,
        status: null,
        trackingProgress: null,
        consignmentId: null,
        hasUnresolvedWebhookIssue: false,
      })),
    );
    return;
  }

  if (
    url.pathname === "/api/v1/delivery/pathao/manage/issues" &&
    method === "GET"
  ) {
    if (!requireStaff(request, response)) return;
    const parsed = PathaoManagementIssuesQuerySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });
    if (!parsed.success) {
      send(response, 400, {
        statusCode: 400,
        message: "Invalid Pathao issue pagination query",
      });
      return;
    }
    send(response, 200, {
      issues: managedDeliveryIssues.slice(
        parsed.data.offset,
        parsed.data.offset + parsed.data.limit,
      ),
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      hasMore:
        parsed.data.offset + parsed.data.limit < managedDeliveryIssues.length,
      nextOffset:
        parsed.data.offset + parsed.data.limit < managedDeliveryIssues.length
          ? parsed.data.offset + parsed.data.limit
          : null,
    });
    return;
  }

  if (url.pathname === "/api/v1/catalog/categories" && method === "GET") {
    send(response, 200, {
      categories: refreshCategoryTree()
        .filter(({ isActive }) => isActive)
        .map(categoryOption),
    });
    return;
  }

  if (
    url.pathname === "/api/v1/catalog/categories/slug-suggestion" &&
    method === "GET"
  ) {
    if (!requireCategoryAdmin(request, response)) return;
    const parsed = CatalogCategorySlugSuggestionQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!parsed.success) {
      send(response, 400, {
        statusCode: 400,
        message: "Invalid category name",
      });
      return;
    }
    send(response, 200, {
      slug: availableSlug(
        parsed.data.name,
        categories.map(({ slug }) => slug),
        CATALOG_CATEGORY_SLUG_MAX_LENGTH,
        "category",
      ),
    });
    return;
  }

  if (
    url.pathname === "/api/v1/catalog/categories/manage" &&
    method === "GET"
  ) {
    if (!requireCategoryAdmin(request, response)) return;
    send(response, 200, { categories: refreshCategoryTree() });
    return;
  }

  if (
    url.pathname === "/api/v1/catalog/categories/manage/page" &&
    method === "GET"
  ) {
    if (!requireCategoryAdmin(request, response)) return;
    const parsed = CatalogCategoryManagementListQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!parsed.success) {
      send(response, 400, {
        statusCode: 400,
        message: "Invalid category pagination query",
      });
      return;
    }

    const { limit, offset, search, status, kind } = parsed.data;
    const normalizedSearch = search?.toLocaleLowerCase("en-US");
    const matchingCategories = refreshCategoryTree()
      .filter((category) => {
        if (status && category.isActive !== (status === "active")) {
          return false;
        }
        if (kind && category.isLeaf !== (kind === "leaf")) return false;
        return (
          !normalizedSearch ||
          [category.path, category.name, category.slug].some((value) =>
            value.toLocaleLowerCase("en-US").includes(normalizedSearch),
          )
        );
      })
      .sort(
        (left, right) =>
          left.path.localeCompare(right.path, "en-US") ||
          left.id.localeCompare(right.id),
      );
    const rows = matchingCategories.slice(offset, offset + limit + 1);
    const hasMore = rows.length > limit;
    const categoriesPage = rows.slice(0, limit);
    const candidateNextOffset = offset + categoriesPage.length;

    send(response, 200, {
      categories: categoriesPage,
      limit,
      offset,
      hasMore,
      nextOffset:
        hasMore && candidateNextOffset <= MAX_LIST_OFFSET
          ? candidateNextOffset
          : null,
    });
    return;
  }

  if (
    url.pathname === "/api/v1/catalog/categories/options/manage" &&
    method === "GET"
  ) {
    if (!requireStaff(request, response)) return;
    send(response, 200, { categories: refreshCategoryTree() });
    return;
  }

  if (url.pathname === "/api/v1/catalog/categories" && method === "POST") {
    if (!requireCategoryAdmin(request, response)) return;
    const parsed = CatalogCategoryCreateSchema.safeParse(
      await readBody(request),
    );
    if (!parsed.success) {
      send(response, 400, {
        statusCode: 400,
        message: "Invalid category input",
      });
      return;
    }
    const input = parsed.data;
    const slug =
      input.slug ??
      availableSlug(
        input.name,
        categories.map(({ slug: existingSlug }) => existingSlug),
        CATALOG_CATEGORY_SLUG_MAX_LENGTH,
        "category",
      );
    if (categories.some(({ slug: existingSlug }) => existingSlug === slug)) {
      send(response, 409, {
        statusCode: 409,
        message: "Category slug already in use.",
        errorCode: "CATALOG_CATEGORY_SLUG_TAKEN",
      });
      return;
    }
    if (
      input.parentId &&
      !categories.some(({ id, isActive }) => id === input.parentId && isActive)
    ) {
      send(response, 400, {
        statusCode: 400,
        message: "Parent category must be active.",
      });
      return;
    }
    const category = makeCategory(input.name, slug, input.parentId ?? null);
    categories.push(category);
    send(
      response,
      201,
      refreshCategoryTree().find(({ id }) => id === category.id),
    );
    return;
  }

  const categoryPath = url.pathname.match(
    /^\/api\/v1\/catalog\/categories\/([^/]+)$/,
  );
  if (categoryPath && method === "PATCH") {
    if (!requireCategoryAdmin(request, response)) return;
    const category = categories.find(({ id }) => id === categoryPath[1]);
    const parsed = CatalogCategoryUpdateSchema.safeParse(
      await readBody(request),
    );
    if (!category || !parsed.success) {
      send(response, category ? 400 : 404, {
        statusCode: category ? 400 : 404,
        message: category ? "Invalid category input" : "Category not found",
      });
      return;
    }
    const input = parsed.data;
    if (
      input.slug &&
      categories.some(
        ({ id, slug }) => id !== category.id && slug === input.slug,
      )
    ) {
      send(response, 409, {
        statusCode: 409,
        message: "Category slug already in use.",
        errorCode: "CATALOG_CATEGORY_SLUG_TAKEN",
      });
      return;
    }
    const parentId =
      input.parentId === undefined ? category.parentId : input.parentId;
    if (parentId) {
      const initialParent = categories.find(({ id }) => id === parentId);
      if (
        !initialParent ||
        (input.isActive !== false && !initialParent.isActive)
      ) {
        send(response, 400, {
          statusCode: 400,
          message: "Parent category must be active.",
        });
        return;
      }
      let parent = categories.find(({ id }) => id === parentId);
      const visited = new Set();
      while (parent) {
        if (parent.id === category.id || visited.has(parent.id)) {
          send(response, 400, {
            statusCode: 400,
            message: "A category cannot be its own ancestor.",
          });
          return;
        }
        visited.add(parent.id);
        parent = parent.parentId
          ? categories.find(({ id }) => id === parent.parentId)
          : null;
      }
    }
    if (category.isActive && input.isActive === false) {
      const referenced =
        products.some(
          ({ category: itemCategory }) => itemCategory?.id === category.id,
        ) ||
        sizeGuides.some(
          ({ category: guideCategory }) => guideCategory.id === category.id,
        ) ||
        categories.some(
          ({ parentId: childParentId, isActive }) =>
            childParentId === category.id && isActive,
        );
      if (referenced) {
        send(response, 409, {
          statusCode: 409,
          message:
            "Move its products, size guides, and active child categories before deactivating this category.",
        });
        return;
      }
    }
    Object.assign(category, {
      name: input.name ?? category.name,
      slug: input.slug ?? category.slug,
      parentId,
      isActive: input.isActive ?? category.isActive,
      updatedAt: new Date().toISOString(),
    });
    send(
      response,
      200,
      refreshCategoryTree().find(({ id }) => id === category.id),
    );
    return;
  }

  if (
    url.pathname === "/api/v1/catalog/size-guides/manage" &&
    method === "GET"
  ) {
    if (!requireStaff(request, response)) return;
    const matching = sizeGuides.filter((guide) => {
      const categoryId = url.searchParams.get("categoryId");
      const fit = url.searchParams.get("fit");
      return (
        (!categoryId || guide.category.id === categoryId) &&
        (!fit || normalize(guide.fit ?? "") === normalize(fit))
      );
    });
    sendPage(response, matching.map(sizeGuideSummary), url, "guides");
    return;
  }

  const managedGuidePath = url.pathname.match(
    /^\/api\/v1\/catalog\/size-guides\/manage\/([^/]+)$/,
  );
  if (managedGuidePath && method === "GET") {
    if (!requireStaff(request, response)) return;
    const guide = sizeGuides.find(({ id }) => id === managedGuidePath[1]);
    if (!guide) {
      send(response, 404, { statusCode: 404, message: "Size guide not found" });
      return;
    }
    send(response, 200, guide);
    return;
  }

  if (url.pathname === "/api/v1/catalog/size-guides" && method === "POST") {
    if (!requireStaff(request, response)) return;
    const parsed = CatalogSizeGuideCreateSchema.safeParse(
      await readBody(request),
    );
    if (!parsed.success) {
      send(response, 400, {
        statusCode: 400,
        message: "Invalid size guide input",
      });
      return;
    }
    if (!isActiveCategory(parsed.data.categoryId)) {
      send(response, 400, {
        statusCode: 400,
        message: "Choose an active category.",
      });
      return;
    }
    const now = new Date().toISOString();
    const guide = makeGuide(parsed.data, now);
    sizeGuides.unshift(guide);
    send(response, 201, guide);
    return;
  }

  const guidePath = url.pathname.match(
    /^\/api\/v1\/catalog\/size-guides\/([^/]+)$/,
  );
  if (guidePath && method === "PATCH") {
    if (!requireStaff(request, response)) return;
    const guide = sizeGuides.find(({ id }) => id === guidePath[1]);
    const parsed = CatalogSizeGuideCreateSchema.safeParse(
      await readBody(request),
    );
    if (!guide || !parsed.success) {
      send(response, guide ? 400 : 404, {
        statusCode: guide ? 400 : 404,
        message: guide ? "Invalid size guide input" : "Size guide not found",
      });
      return;
    }
    const candidate = makeGuide(parsed.data, guide.createdAt);
    candidate.id = guide.id;
    candidate.updatedAt = new Date().toISOString();
    if (!isActiveCategory(parsed.data.categoryId)) {
      send(response, 400, {
        statusCode: 400,
        message: "Choose an active category.",
      });
      return;
    }
    if (
      products.some(
        (product) =>
          product.sizeGuideId === guide.id &&
          product.isPublished &&
          !isPublishable(product, product.variants, candidate),
      )
    ) {
      send(response, 400, {
        statusCode: 400,
        message: "Updated guide would invalidate a published product.",
      });
      return;
    }
    Object.assign(guide, candidate);
    send(response, 200, guide);
    return;
  }

  if (url.pathname === "/api/v1/catalog/products/manage" && method === "GET") {
    if (!requireStaff(request, response)) return;
    sendProductPage(response, products, url);
    return;
  }

  if (url.pathname === "/api/v1/catalog/products/filters" && method === "GET") {
    const publishedProducts = products.filter(({ isPublished }) => isPublished);
    const purchasableVariants = publishedProducts.flatMap((product) =>
      product.variants.filter(
        ({ isActive, price }) => isActive && price !== null,
      ),
    );
    send(response, 200, {
      categories: publicCategoryFilters(publishedProducts),
      colors: uniqueFilterValues(purchasableVariants.map(({ color }) => color)),
      sizes: uniqueFilterValues(
        purchasableVariants.map(({ sizeLabel }) => sizeLabel),
      ),
      priceRange: getPublishedPriceRange(publishedProducts),
    });
    return;
  }

  if (
    url.pathname === "/api/v1/catalog/products/slug-suggestion" &&
    method === "GET"
  ) {
    if (!requireStaff(request, response)) return;
    const parsed = CatalogProductSlugSuggestionQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!parsed.success) {
      send(response, 400, {
        statusCode: 400,
        message: "Invalid product name",
      });
      return;
    }
    send(response, 200, {
      slug: availableSlug(
        parsed.data.name,
        products.map(({ slug }) => slug),
        CATALOG_PRODUCT_SLUG_MAX_LENGTH,
        "product",
      ),
    });
    return;
  }

  const managedProductPath = url.pathname.match(
    /^\/api\/v1\/catalog\/products\/manage\/([^/]+)$/,
  );
  if (managedProductPath && method === "GET") {
    if (!requireStaff(request, response)) return;
    const product = products.find(({ id }) => id === managedProductPath[1]);
    if (!product) {
      send(response, 404, { statusCode: 404, message: "Product not found" });
      return;
    }
    send(response, 200, productDetail(product, true));
    return;
  }

  if (url.pathname === "/api/v1/catalog/products" && method === "GET") {
    sendPublishedProductPage(
      response,
      products.filter((product) => product.isPublished),
      url,
    );
    return;
  }

  if (
    url.pathname === "/api/v1/catalog/products/media-e2e-fixture" &&
    method === "GET"
  ) {
    send(response, 200, mediaFixtureProduct);
    return;
  }

  if (
    [mediaFixturePath, mediaFixtureCardPath].includes(url.pathname) &&
    method === "GET"
  ) {
    response.writeHead(200, {
      "Content-Type": "image/webp",
      "Content-Length": String(mediaFixtureBytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(mediaFixtureBytes);
    return;
  }

  if (url.pathname === "/api/v1/catalog/products" && method === "POST") {
    if (!requireStaff(request, response)) return;
    const parsed = CatalogProductCreateSchema.safeParse(
      await readBody(request),
    );
    if (!parsed.success) {
      send(response, 400, {
        statusCode: 400,
        message: "Invalid product input",
      });
      return;
    }
    const body = parsed.data;
    const slug =
      body.slug ??
      availableSlug(
        body.name,
        products.map((product) => product.slug),
        CATALOG_PRODUCT_SLUG_MAX_LENGTH,
        "product",
      );
    if (products.some((product) => product.slug === slug)) {
      send(response, 409, {
        statusCode: 409,
        message: "A product with this slug already exists",
        errorCode: "CATALOG_PRODUCT_SLUG_TAKEN",
      });
      return;
    }
    if (hasVariantConflict(body.variants ?? [])) {
      send(response, 409, {
        statusCode: 409,
        message: "A variant SKU or color and size combination already exists.",
      });
      return;
    }
    if (body.categoryId && !isActiveLeafCategory(body.categoryId)) {
      send(response, 400, {
        statusCode: 400,
        message: "Choose an active leaf product category.",
      });
      return;
    }
    const now = new Date().toISOString();
    const product = {
      id: randomUUID(),
      slug,
      name: body.name,
      description: body.description ?? null,
      audience: body.audience,
      category: body.categoryId
        ? categoryReference(categories.find(({ id }) => id === body.categoryId))
        : null,
      fit: body.fit ?? null,
      fabricComposition: body.fabricComposition ?? null,
      careInstructions: body.careInstructions ?? null,
      sizeGuideId: body.sizeGuideId ?? null,
      isPublished: body.isPublished ?? false,
      createdAt: now,
      updatedAt: now,
      variants: (body.variants ?? []).map((variant) => ({
        ...variant,
        id: randomUUID(),
        gtin: variant.gtin ?? null,
        isActive: true,
      })),
    };
    if (
      product.isPublished &&
      !isPublishable(
        product,
        product.variants,
        sizeGuides.find(({ id }) => id === product.sizeGuideId),
      )
    ) {
      send(response, 400, {
        statusCode: 400,
        message:
          "Product needs matching variants and a size guide before publishing.",
      });
      return;
    }
    products.unshift(product);
    send(response, 201, summary(product));
    return;
  }

  const productPath = url.pathname.match(
    /^\/api\/v1\/catalog\/products\/([^/]+)$/,
  );
  if (productPath && method === "GET") {
    const product = products.find(
      (candidate) =>
        candidate.slug === decodeURIComponent(productPath[1]) &&
        candidate.isPublished,
    );
    if (!product) {
      send(response, 404, { statusCode: 404, message: "Product not found" });
      return;
    }
    send(response, 200, productDetail(product));
    return;
  }

  if (productPath && method === "PATCH") {
    if (!requireStaff(request, response)) return;
    const product = products.find(({ id }) => id === productPath[1]);
    if (!product) {
      send(response, 404, { statusCode: 404, message: "Product not found" });
      return;
    }
    const parsed = CatalogProductUpdateSchema.safeParse(
      await readBody(request),
    );
    if (!parsed.success) {
      send(response, 400, {
        statusCode: 400,
        message: "Invalid product input",
      });
      return;
    }
    const body = parsed.data;
    if (
      body.slug &&
      products.some(
        (candidate) =>
          candidate.id !== product.id && candidate.slug === body.slug,
      )
    ) {
      send(response, 409, {
        statusCode: 409,
        message: "A product with this slug already exists",
        errorCode: "CATALOG_PRODUCT_SLUG_TAKEN",
      });
      return;
    }
    const variants = body.variants
      ? body.variants.map((variant) => ({
          ...variant,
          id: randomUUID(),
          gtin: variant.gtin ?? null,
          isActive: true,
        }))
      : product.variants;
    if (body.variants && hasVariantConflict(body.variants, product.id)) {
      send(response, 409, {
        statusCode: 409,
        message: "A variant SKU or color and size combination already exists.",
      });
      return;
    }
    const categoryId =
      body.categoryId !== undefined ? body.categoryId : product.category?.id;
    if (categoryId && !isActiveLeafCategory(categoryId)) {
      send(response, 400, {
        statusCode: 400,
        message: "Choose an active leaf product category.",
      });
      return;
    }
    const candidate = {
      ...product,
      slug: body.slug ?? product.slug,
      name: body.name ?? product.name,
      description:
        body.description !== undefined ? body.description : product.description,
      audience: body.audience ?? product.audience,
      category: categoryId
        ? categoryReference(categories.find(({ id }) => id === categoryId))
        : null,
      fit: body.fit !== undefined ? body.fit : product.fit,
      fabricComposition:
        body.fabricComposition !== undefined
          ? body.fabricComposition
          : product.fabricComposition,
      careInstructions:
        body.careInstructions !== undefined
          ? body.careInstructions
          : product.careInstructions,
      sizeGuideId:
        body.sizeGuideId !== undefined ? body.sizeGuideId : product.sizeGuideId,
      isPublished: body.isPublished ?? product.isPublished,
      variants,
      updatedAt: new Date().toISOString(),
    };
    if (
      candidate.isPublished &&
      !isPublishable(
        candidate,
        variants,
        sizeGuides.find(({ id }) => id === candidate.sizeGuideId),
      )
    ) {
      send(response, 400, {
        statusCode: 400,
        message:
          "Product needs matching variants and a size guide before publishing.",
      });
      return;
    }
    Object.assign(product, candidate);
    send(response, 200, summary(product));
    return;
  }

  send(response, 404, { statusCode: 404, message: "Not found" });
});

function makeGuide(input, createdAt) {
  const now = createdAt ?? new Date().toISOString();
  return {
    id: randomUUID(),
    name: input.name,
    category: categoryReference(
      input.category ?? categories.find(({ id }) => id === input.categoryId),
    ),
    fit: input.fit ?? null,
    measurementBasis: input.measurementBasis,
    rows: input.rows.map((row, sortOrder) => ({
      id: randomUUID(),
      sizeLabel: row.sizeLabel,
      sortOrder,
      measurements: row.measurements.map((measurement) => ({
        key: measurement.key,
        valueIn: Number(measurement.value).toFixed(1),
      })),
    })),
    createdAt: createdAt ?? now,
    updatedAt: now,
  };
}

function sizeGuideSummary(guide) {
  return {
    id: guide.id,
    name: guide.name,
    category: guide.category,
    fit: guide.fit,
    measurementBasis: guide.measurementBasis,
    sizeLabels: guide.rows.map(({ sizeLabel }) => sizeLabel),
    updatedAt: guide.updatedAt,
  };
}

function availableSlug(name, existingSlugs, maxLength, fallback) {
  const normalized = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  const base =
    normalized
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxLength)
      .replace(/-+$/g, "") || fallback;
  const used = new Set(existingSlugs);
  for (let suffix = 1; ; suffix += 1) {
    const ending = suffix === 1 ? "" : `-${suffix}`;
    const prefix = base.slice(0, maxLength - ending.length).replace(/-+$/g, "");
    const slug = `${prefix}${ending}`;
    if (!used.has(slug)) return slug;
  }
}

function makeCategory(name, slug, parentId = null) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name,
    slug,
    parentId,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    path: name,
    isLeaf: true,
  };
}

function refreshCategoryTree() {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const hasChildren = new Set(
    categories.flatMap(({ parentId }) => (parentId ? [parentId] : [])),
  );
  const pathFor = (category, seen = new Set()) => {
    if (seen.has(category.id)) return category.name;
    seen.add(category.id);
    const parent = category.parentId ? byId.get(category.parentId) : null;
    return parent
      ? `${pathFor(parent, seen)} / ${category.name}`
      : category.name;
  };
  for (const category of categories) {
    category.path = pathFor(category);
    category.isLeaf = !hasChildren.has(category.id);
  }
  return [...categories].sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.id.localeCompare(right.id),
  );
}

function categoryOption(category) {
  const { id, name, slug, parentId, path, isLeaf } = category;
  return { id, name, slug, parentId, path, isLeaf };
}

function categoryReference(category) {
  if (!category) return null;
  const { id, name, slug, parentId } = category;
  return { id, name, slug, parentId };
}

function isActiveCategory(categoryId) {
  const category = categories.find(({ id }) => id === categoryId);
  return Boolean(category?.isActive);
}

function isActiveLeafCategory(categoryId) {
  return (
    isActiveCategory(categoryId) &&
    !categories.some(({ parentId }) => parentId === categoryId)
  );
}

function isCategoryOrDescendant(categoryId, ancestorId) {
  const visited = new Set();
  let current = categories.find(({ id }) => id === categoryId);
  while (current && !visited.has(current.id)) {
    if (current.id === ancestorId) return true;
    visited.add(current.id);
    current = current.parentId
      ? categories.find(({ id }) => id === current.parentId)
      : null;
  }
  return false;
}

function categoryMatches(categoryId, slug) {
  const root = categories.find(
    (category) => category.slug === slug && category.isActive,
  );
  const productCategory = categories.find(({ id }) => id === categoryId);
  if (!root || !productCategory) return false;
  let current = productCategory;
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    if (current.id === root.id) return true;
    visited.add(current.id);
    current = current.parentId
      ? categories.find(({ id }) => id === current.parentId)
      : null;
  }
  return false;
}

function productDetail(product, management = false) {
  const guide = sizeGuides.find(({ id }) => id === product.sizeGuideId);
  return {
    ...summary(product),
    ...(management
      ? {}
      : {
          images: (product.images ?? []).map((image) => ({
            ...image,
            variantId: image.variantId ?? null,
          })),
        }),
    variants: product.variants
      .filter(({ isActive }) => isActive)
      .map((variant) =>
        management
          ? variant
          : {
              id: variant.id,
              color: variant.color,
              sizeLabel: variant.sizeLabel,
              price: variant.price,
            },
      ),
    sizeGuide: guide ?? null,
  };
}

function summary(product) {
  const fields = { ...product };
  delete fields.variants;
  const price = startingPrice(product);
  return {
    ...fields,
    price: price === null ? null : { amountBdt: price },
  };
}

function startingPrice(product) {
  const prices = product.variants.flatMap((variant) =>
    variant.isActive && variant.price !== null ? [variant.price.amountBdt] : [],
  );
  return prices.length ? Math.min(...prices) : null;
}

function isPublishable(product, variants, guide) {
  return Boolean(
    product.audience &&
    product.category?.id &&
    guide &&
    variants.length > 0 &&
    variants.every((variant) => variant.price !== null) &&
    isCategoryOrDescendant(product.category.id, guide.category.id) &&
    normalize(product.fit ?? "") === normalize(guide.fit ?? "") &&
    variants.every((variant) =>
      guide.rows.some(
        (row) => normalize(row.sizeLabel) === normalize(variant.sizeLabel),
      ),
    ),
  );
}

function hasVariantConflict(variants, currentProductId = null) {
  const skus = new Set();
  const combinations = new Set();
  for (const variant of variants) {
    const sku = normalize(variant.sku);
    const combination = `${normalize(variant.color)}\u0000${normalize(variant.sizeLabel)}`;
    if (skus.has(sku) || combinations.has(combination)) return true;
    skus.add(sku);
    combinations.add(combination);
  }
  return products.some(
    (product) =>
      product.id !== currentProductId &&
      product.variants.some((existing) => skus.has(normalize(existing.sku))),
  );
}

function sendProductPage(response, source, url) {
  sendPage(response, source.map(summary), url, "products");
}

function sendPublishedProductPage(response, source, url) {
  const input = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(input, key)) {
      const previous = input[key];
      input[key] = Array.isArray(previous)
        ? [...previous, value]
        : [previous, value];
    } else {
      input[key] = value;
    }
  }
  const parsed = CatalogPublishedProductListQuerySchema.safeParse(input);
  if (!parsed.success) {
    send(response, 400, {
      statusCode: 400,
      message: "Invalid public catalog query",
    });
    return;
  }

  const query = parsed.data;
  const facetSource = query.category
    ? source.filter((product) =>
        categoryMatches(product.category?.id, query.category),
      )
    : source;
  const matching = source.filter((product) => {
    if (
      query.search &&
      ![
        product.name,
        product.description,
        product.fit,
        product.fabricComposition,
        product.careInstructions,
      ].some((value) =>
        normalize(value ?? "").includes(normalize(query.search)),
      )
    ) {
      return false;
    }
    if (query.audience && product.audience !== query.audience) return false;
    if (
      query.category &&
      !categoryMatches(product.category?.id, query.category)
    ) {
      return false;
    }
    const colors = (query.color ?? []).map(normalize);
    const sizes = (query.size ?? []).map(normalize);
    if (
      colors.length ||
      sizes.length ||
      query.minPriceBdt !== undefined ||
      query.maxPriceBdt !== undefined
    ) {
      return product.variants.some(
        (variant) =>
          variant.isActive &&
          (!colors.length || colors.includes(normalize(variant.color))) &&
          (!sizes.length || sizes.includes(normalize(variant.sizeLabel))) &&
          variant.price !== null &&
          (query.minPriceBdt === undefined ||
            variant.price.amountBdt >= query.minPriceBdt) &&
          (query.maxPriceBdt === undefined ||
            variant.price.amountBdt <= query.maxPriceBdt),
      );
    }
    return true;
  });
  const ordered = [...matching].sort((left, right) => {
    if (query.sort === "price-ascending") {
      const byPrice = startingPrice(left) - startingPrice(right);
      if (byPrice !== 0) return byPrice;
    }
    if (query.sort === "price-descending") {
      const byPrice = startingPrice(right) - startingPrice(left);
      if (byPrice !== 0) return byPrice;
    }
    const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
    return byCreatedAt || right.id.localeCompare(left.id);
  });
  const rows = ordered.slice(query.offset, query.offset + query.limit + 1);
  const hasMore = rows.length > query.limit;
  const pageRows = rows.slice(0, query.limit);
  const candidateNextOffset = query.offset + pageRows.length;
  send(response, 200, {
    products: pageRows.map((product) => {
      const purchasableVariants = product.variants.filter(
        ({ isActive, price }) => isActive && price !== null,
      );
      return {
        ...summary(product),
        images: product.images ?? [],
        priceVaries:
          new Set(purchasableVariants.map(({ price }) => price.amountBdt))
            .size > 1,
      };
    }),
    limit: query.limit,
    offset: query.offset,
    hasMore,
    nextOffset:
      hasMore && candidateNextOffset <= MAX_LIST_OFFSET
        ? candidateNextOffset
        : null,
    filters: {
      categories: publicCategoryFilters(source),
      colors: uniqueFilterValues(
        facetSource.flatMap((product) =>
          product.variants
            .filter(({ isActive }) => isActive)
            .map(({ color }) => color),
        ),
      ),
      sizes: uniqueFilterValues(
        facetSource.flatMap((product) =>
          product.variants
            .filter(({ isActive }) => isActive)
            .map(({ sizeLabel }) => sizeLabel),
        ),
      ),
      priceRange: getPublishedPriceRange(facetSource),
    },
  });
}

function publicCategoryFilters(source) {
  const visible = new Set();
  const publishedProductCounts = new Map();
  for (const product of source) {
    let current = product.category;
    const visited = new Set();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      visible.add(current.id);
      publishedProductCounts.set(
        current.id,
        (publishedProductCounts.get(current.id) ?? 0) + 1,
      );
      current = current.parentId
        ? categories.find(({ id }) => id === current.parentId)
        : null;
    }
  }
  return refreshCategoryTree()
    .filter(({ id, isActive }) => isActive && visible.has(id))
    .map((category) => ({
      ...categoryOption(category),
      publishedProductCount: publishedProductCounts.get(category.id) ?? 0,
    }));
}

function sendPage(response, source, url, key) {
  const rawLimit = url.searchParams.get("limit");
  const rawOffset = url.searchParams.get("offset");
  const limit = Number(rawLimit ?? DEFAULT_LIST_PAGE_SIZE);
  const offset = Number(rawOffset ?? 0);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIST_PAGE_SIZE ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > MAX_LIST_OFFSET
  ) {
    send(response, 400, {
      statusCode: 400,
      message: "Invalid catalog pagination parameters",
    });
    return;
  }
  const ordered = [...source].sort((left, right) => {
    const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
    return byUpdatedAt || right.id.localeCompare(left.id);
  });
  const rows = ordered.slice(offset, offset + limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const candidateNextOffset = offset + pageRows.length;
  send(response, 200, {
    [key]: pageRows,
    limit,
    offset,
    hasMore,
    nextOffset:
      hasMore && candidateNextOffset <= MAX_LIST_OFFSET
        ? candidateNextOffset
        : null,
  });
}

function normalize(value) {
  return value.trim().toLowerCase();
}

function uniqueFilterValues(values) {
  const unique = new Map();
  const candidates = values
    .filter((value) => Boolean(value?.trim()))
    .map((value) => value.trim())
    .sort((left, right) =>
      left.localeCompare(right, "en", { sensitivity: "variant" }),
    );
  for (const displayValue of candidates) {
    const normalizedValue = normalize(displayValue);
    if (!unique.has(normalizedValue)) unique.set(normalizedValue, displayValue);
  }
  return [...unique.values()].sort((left, right) =>
    left.localeCompare(right, "en", { sensitivity: "base" }),
  );
}

function getPublishedPriceRange(products) {
  let priceRange = null;
  for (const product of products) {
    for (const variant of product.variants) {
      if (!variant.isActive || !variant.price) continue;
      const amountBdt = variant.price.amountBdt;
      priceRange = priceRange
        ? {
            minPriceBdt: Math.min(priceRange.minPriceBdt, amountBdt),
            maxPriceBdt: Math.max(priceRange.maxPriceBdt, amountBdt),
          }
        : { minPriceBdt: amountBdt, maxPriceBdt: amountBdt };
    }
  }
  return priceRange;
}

server.listen(port, host);
