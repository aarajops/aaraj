import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  CatalogProductCreateSchema,
  CatalogPublishedProductListQuerySchema,
  CatalogProductUpdateSchema,
  CatalogSizeGuideCreateSchema,
  CatalogCategoryCreateSchema,
  CatalogCategoryUpdateSchema,
  DEFAULT_LIST_PAGE_SIZE,
  MAX_LIST_OFFSET,
  MAX_LIST_PAGE_SIZE,
} from "@aaraj/contracts";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3181);
const products = [];
const clothingCategory = makeCategory("Clothing", "clothing");
const tshirtCategory = makeCategory(
  "T-shirts",
  "t-shirts",
  clothingCategory.id,
);
const categories = [clothingCategory, tshirtCategory];
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
      inputUnit: "cm",
      rows: [
        {
          sizeLabel: index === 0 ? "S" : "M",
          measurements: [{ key: "chest_width", value: "50" }],
        },
      ],
    },
    new Date(Date.UTC(2020, 0, index + 1)).toISOString(),
  ),
);

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
  if (["staff", "staff-stale", "admin", "superadmin"].includes(role))
    return true;
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

function requireRecentSignIn(request, response) {
  if (roleFromCookie(request.headers.cookie) !== "staff-stale") return true;
  send(response, 403, {
    statusCode: 403,
    code: "RECENT_SIGN_IN_REQUIRED",
    message: "Sign in again before this action (within 15 minutes).",
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

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  const method = request.method ?? "GET";
  if (url.pathname === "/api/health/ready") {
    send(response, 200, { status: "ok" });
    return;
  }
  if (url.pathname === "/api/auth/get-session") {
    send(response, 200, null);
    return;
  }
  if (url.pathname === "/api/access/me" && method === "GET") {
    const requestedRole = roleFromCookie(request.headers.cookie);
    if (!requestedRole) {
      send(response, 401, { statusCode: 401, message: "Unauthorized" });
      return;
    }

    const role = requestedRole === "staff-stale" ? "staff" : requestedRole;
    const permissions = ["access.read_self"];
    if (["staff", "admin", "superadmin"].includes(role)) {
      permissions.push("catalog.manage");
    }
    if (["admin", "superadmin"].includes(role)) {
      permissions.push("catalog.categories.manage");
    }
    send(response, 200, {
      userId: "aaraj-e2e-user",
      roles: [role],
      permissions,
    });
    return;
  }

  if (url.pathname === "/api/catalog/categories" && method === "GET") {
    send(response, 200, {
      categories: refreshCategoryTree()
        .filter(({ isActive }) => isActive)
        .map(categoryOption),
    });
    return;
  }

  if (url.pathname === "/api/catalog/categories/manage" && method === "GET") {
    if (!requireCategoryAdmin(request, response)) return;
    send(response, 200, { categories: refreshCategoryTree() });
    return;
  }

  if (url.pathname === "/api/catalog/categories" && method === "POST") {
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
    if (categories.some(({ slug }) => slug === input.slug)) {
      send(response, 409, {
        statusCode: 409,
        message: "Category slug already in use.",
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
    const category = makeCategory(
      input.name,
      input.slug,
      input.parentId ?? null,
    );
    category.sortOrder = input.sortOrder ?? 0;
    categories.push(category);
    send(
      response,
      201,
      refreshCategoryTree().find(({ id }) => id === category.id),
    );
    return;
  }

  const categoryPath = url.pathname.match(
    /^\/api\/catalog\/categories\/([^/]+)$/,
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
      sortOrder: input.sortOrder ?? category.sortOrder,
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

  if (url.pathname === "/api/catalog/size-guides/manage" && method === "GET") {
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
    /^\/api\/catalog\/size-guides\/manage\/([^/]+)$/,
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

  if (url.pathname === "/api/catalog/size-guides" && method === "POST") {
    if (!requireStaff(request, response)) return;
    if (!requireRecentSignIn(request, response)) return;
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
    if (!isActiveLeafCategory(parsed.data.categoryId)) {
      send(response, 400, {
        statusCode: 400,
        message: "Choose an active leaf product category.",
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
    /^\/api\/catalog\/size-guides\/([^/]+)$/,
  );
  if (guidePath && method === "PATCH") {
    if (!requireStaff(request, response)) return;
    if (!requireRecentSignIn(request, response)) return;
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
    if (!isActiveLeafCategory(parsed.data.categoryId)) {
      send(response, 400, {
        statusCode: 400,
        message: "Choose an active leaf product category.",
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

  if (url.pathname === "/api/catalog/products/manage" && method === "GET") {
    if (!requireStaff(request, response)) return;
    sendProductPage(response, products, url);
    return;
  }

  const managedProductPath = url.pathname.match(
    /^\/api\/catalog\/products\/manage\/([^/]+)$/,
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

  if (url.pathname === "/api/catalog/products" && method === "GET") {
    sendPublishedProductPage(
      response,
      products.filter((product) => product.isPublished),
      url,
    );
    return;
  }

  if (url.pathname === "/api/catalog/products" && method === "POST") {
    if (!requireStaff(request, response)) return;
    if (!requireRecentSignIn(request, response)) return;
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
    if (products.some((product) => product.slug === body.slug)) {
      send(response, 409, {
        statusCode: 409,
        message: "A product with this slug already exists",
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
      slug: body.slug,
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

  const productPath = url.pathname.match(/^\/api\/catalog\/products\/([^/]+)$/);
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
    if (!requireRecentSignIn(request, response)) return;
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
        valueMm: toMillimeters(input.inputUnit, measurement.value),
      })),
    })),
    createdAt: createdAt ?? now,
    updatedAt: now,
  };
}

function toMillimeters(unit, value) {
  const [whole, fraction = ""] = value.split(".");
  const thousandths = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  const hundredths =
    unit === "cm" ? thousandths : (thousandths * 254n + 50n) / 100n;
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, "0")}`;
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

function makeCategory(name, slug, parentId = null) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name,
    slug,
    parentId,
    sortOrder: 0,
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
      left.sortOrder - right.sortOrder || left.path.localeCompare(right.path),
  );
}

function categoryOption(category) {
  const { id, name, slug, parentId, sortOrder, path, isLeaf } = category;
  return { id, name, slug, parentId, sortOrder, path, isLeaf };
}

function categoryReference(category) {
  if (!category) return null;
  const { id, name, slug, parentId } = category;
  return { id, name, slug, parentId };
}

function isActiveLeafCategory(categoryId) {
  const category = categories.find(({ id }) => id === categoryId);
  return Boolean(
    category?.isActive &&
    !categories.some(({ parentId }) => parentId === categoryId),
  );
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
  return {
    ...summary(product),
    variants: product.variants
      .filter(({ isActive }) => isActive)
      .map((variant) =>
        management
          ? variant
          : {
              id: variant.id,
              color: variant.color,
              sizeLabel: variant.sizeLabel,
            },
      ),
    sizeGuide: sizeGuides.find(({ id }) => id === product.sizeGuideId) ?? null,
  };
}

function summary(product) {
  const fields = { ...product };
  delete fields.variants;
  const activeVariants = product.variants.filter(({ isActive }) => isActive);
  const guide = sizeGuides.find(({ id }) => id === product.sizeGuideId);
  const sizeOrder = new Map(
    guide?.rows.map((row, index) => [normalize(row.sizeLabel), index]) ?? [],
  );
  const firstVariant = [...activeVariants].sort((left, right) => {
    const colorOrder = left.color.localeCompare(right.color);
    if (colorOrder !== 0) return colorOrder;
    const leftOrder = sizeOrder.get(normalize(left.sizeLabel));
    const rightOrder = sizeOrder.get(normalize(right.sizeLabel));
    if (leftOrder !== undefined && rightOrder !== undefined) {
      return leftOrder - rightOrder;
    }
    if (leftOrder !== undefined) return -1;
    if (rightOrder !== undefined) return 1;
    return left.sizeLabel.localeCompare(right.sizeLabel);
  })[0];
  return {
    ...fields,
    price: firstVariant?.price ?? null,
  };
}

function isPublishable(product, variants, guide) {
  return Boolean(
    product.audience &&
    product.category?.id &&
    guide &&
    variants.length > 0 &&
    variants.every((variant) => variant.price !== null) &&
    product.category.id === guide.category.id &&
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
  const matching = source.filter((product) => {
    if (query.audience && product.audience !== query.audience) return false;
    if (
      query.category &&
      !categoryMatches(product.category?.id, query.category)
    ) {
      return false;
    }
    if (query.color || query.size) {
      return product.variants.some(
        (variant) =>
          variant.isActive &&
          (!query.color ||
            normalize(variant.color) === normalize(query.color)) &&
          (!query.size ||
            normalize(variant.sizeLabel) === normalize(query.size)),
      );
    }
    return true;
  });
  const ordered = [...matching].sort((left, right) => {
    const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
    return byUpdatedAt || right.id.localeCompare(left.id);
  });
  const rows = ordered.slice(query.offset, query.offset + query.limit + 1);
  const hasMore = rows.length > query.limit;
  const pageRows = rows.slice(0, query.limit);
  const candidateNextOffset = query.offset + pageRows.length;
  send(response, 200, {
    products: pageRows.map(summary),
    hasMore,
    nextOffset:
      hasMore && candidateNextOffset <= MAX_LIST_OFFSET
        ? candidateNextOffset
        : null,
    filters: {
      categories: publicCategoryFilters(source),
      colors: uniqueFilterValues(
        source.flatMap((product) =>
          product.variants
            .filter(({ isActive }) => isActive)
            .map(({ color }) => color),
        ),
      ),
      sizes: uniqueFilterValues(
        source.flatMap((product) =>
          product.variants
            .filter(({ isActive }) => isActive)
            .map(({ sizeLabel }) => sizeLabel),
        ),
      ),
    },
  });
}

function publicCategoryFilters(source) {
  const visible = new Set();
  for (const product of source) {
    let current = product.category;
    const visited = new Set();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      visible.add(current.id);
      current = current.parentId
        ? categories.find(({ id }) => id === current.parentId)
        : null;
    }
  }
  return refreshCategoryTree()
    .filter(({ id, isActive }) => isActive && visible.has(id))
    .map(categoryOption);
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

server.listen(port, host);
