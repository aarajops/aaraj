import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_LIST_PAGE_SIZE,
  MAX_LIST_OFFSET,
  MAX_LIST_PAGE_SIZE,
} from "@aaraj/contracts";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3181);
const products = [];

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
  if (url.pathname === "/api/health/ready") {
    send(response, 200, { status: "ok" });
    return;
  }
  if (url.pathname === "/api/auth/get-session") {
    send(response, 200, null);
    return;
  }

  if (url.pathname === "/api/catalog/products/manage") {
    if (!requireStaff(request, response)) return;
    sendProductPage(response, products, url);
    return;
  }

  if (url.pathname === "/api/catalog/products" && request.method === "GET") {
    sendProductPage(
      response,
      products.filter((product) => product.isPublished),
      url,
    );
    return;
  }

  if (url.pathname === "/api/catalog/products" && request.method === "POST") {
    if (!requireStaff(request, response)) return;
    if (!requireRecentSignIn(request, response)) return;
    const body = await readBody(request);
    if (!isValidProductInput(body)) {
      send(response, 400, {
        statusCode: 400,
        message: "Invalid product input",
      });
      return;
    }
    if (products.some((product) => product.slug === body.slug)) {
      send(response, 409, {
        statusCode: 409,
        message: "A product with this slug already exists",
      });
      return;
    }
    const now = new Date().toISOString();
    const product = {
      id: randomUUID(),
      slug: body.slug,
      name: body.name,
      description: body.description,
      isPublished: body.isPublished,
      createdAt: now,
      updatedAt: now,
    };
    products.unshift(product);
    send(response, 201, product);
    return;
  }

  const productPath = url.pathname.match(/^\/api\/catalog\/products\/([^/]+)$/);
  if (productPath && request.method === "GET") {
    const product = products.find(
      (candidate) =>
        candidate.slug === decodeURIComponent(productPath[1]) &&
        candidate.isPublished,
    );
    if (!product) {
      send(response, 404, { statusCode: 404, message: "Product not found" });
      return;
    }
    send(response, 200, product);
    return;
  }

  if (productPath && request.method === "PATCH") {
    if (!requireStaff(request, response)) return;
    if (!requireRecentSignIn(request, response)) return;
    const product = products.find(
      (candidate) => candidate.id === productPath[1],
    );
    if (!product) {
      send(response, 404, { statusCode: 404, message: "Product not found" });
      return;
    }
    const body = await readBody(request);
    if (
      !body ||
      typeof body.reason !== "string" ||
      body.reason.trim().length < 3
    ) {
      send(response, 400, {
        statusCode: 400,
        message: "An audit reason is required",
      });
      return;
    }
    if (
      typeof body.slug === "string" &&
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
    for (const field of ["slug", "name", "description", "isPublished"]) {
      if (field in body) product[field] = body[field];
    }
    product.updatedAt = new Date().toISOString();
    send(response, 200, product);
    return;
  }

  send(response, 404, { statusCode: 404, message: "Not found" });
});

function sendProductPage(response, source, url) {
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

  send(response, 200, productPage(source, limit, offset));
}

function productPage(source, limit, offset) {
  const ordered = [...source].sort((left, right) => {
    const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
    return byUpdatedAt || right.id.localeCompare(left.id);
  });
  const rows = ordered.slice(offset, offset + limit + 1);
  const hasMore = rows.length > limit;
  const pageProducts = rows.slice(0, limit);
  const candidateNextOffset = offset + pageProducts.length;

  return {
    products: pageProducts,
    hasMore,
    nextOffset:
      hasMore && candidateNextOffset <= MAX_LIST_OFFSET
        ? candidateNextOffset
        : null,
  };
}

function isValidProductInput(body) {
  return (
    body &&
    typeof body.slug === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug) &&
    typeof body.name === "string" &&
    body.name.trim().length > 0 &&
    (body.description === null || typeof body.description === "string") &&
    typeof body.isPublished === "boolean" &&
    typeof body.reason === "string" &&
    body.reason.trim().length >= 3
  );
}

server.listen(port, host);
