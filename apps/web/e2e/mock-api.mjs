import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  CatalogProductCreateSchema,
  CatalogPublishedProductListQuerySchema,
  CatalogProductUpdateSchema,
  CatalogSizeGuideCreateSchema,
  DEFAULT_LIST_PAGE_SIZE,
  MAX_LIST_OFFSET,
  MAX_LIST_PAGE_SIZE,
} from "@aaraj/contracts";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3181);
const products = [];
const sizeGuides = Array.from({ length: 100 }, (_, index) =>
  makeGuide(
    {
      name:
        index === 0
          ? "Legacy guide beyond the first page"
          : `Historical guide ${index + 1}`,
      category: index === 0 ? "T-shirts" : `Category ${index + 1}`,
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
  if (role === "staff" || role === "staff-stale") return true;
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

  if (url.pathname === "/api/catalog/size-guides/manage" && method === "GET") {
    if (!requireStaff(request, response)) return;
    const matching = sizeGuides.filter((guide) => {
      const category = url.searchParams.get("category");
      const fit = url.searchParams.get("fit");
      return (
        (!category || normalize(guide.category) === normalize(category)) &&
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
    const now = new Date().toISOString();
    const product = {
      id: randomUUID(),
      slug: body.slug,
      name: body.name,
      description: body.description ?? null,
      audience: body.audience,
      category: body.category,
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
    const candidate = {
      ...product,
      slug: body.slug ?? product.slug,
      name: body.name ?? product.name,
      description:
        body.description !== undefined ? body.description : product.description,
      audience: body.audience ?? product.audience,
      category: body.category ?? product.category,
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
    category: input.category,
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
  return fields;
}

function isPublishable(product, variants, guide) {
  return Boolean(
    product.audience &&
    product.category &&
    guide &&
    variants.length > 0 &&
    normalize(product.category) === normalize(guide.category) &&
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
      normalize(product.category ?? "") !== normalize(query.category)
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
      categories: uniqueFilterValues(source.map(({ category }) => category)),
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
