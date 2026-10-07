import { defineConfig } from "drizzle-kit";
import { loadLocalEnvironment } from "./src/platform/config/local-environment.js";
import { getPostgresSslOptions } from "./src/platform/database/postgres-ssl.js";

loadLocalEnvironment();

const isProduction = process.env.NODE_ENV === "production";
if (
  isProduction &&
  (!process.env.MIGRATION_POSTGRES_USER ||
    !process.env.MIGRATION_POSTGRES_PASSWORD)
) {
  throw new Error(
    "MIGRATION_POSTGRES_USER and MIGRATION_POSTGRES_PASSWORD must be configured for production migrations.",
  );
}
if (isProduction && (!process.env.POSTGRES_DB || !process.env.POSTGRES_USER)) {
  throw new Error(
    "POSTGRES_DB and the restricted POSTGRES_USER runtime role must be configured for production migrations.",
  );
}
if (
  isProduction &&
  process.env.MIGRATION_POSTGRES_USER === process.env.POSTGRES_USER
) {
  throw new Error(
    "Production migrations must use a database role separate from the API runtime role.",
  );
}
if (isProduction && !process.env.POSTGRES_HOST) {
  throw new Error(
    "POSTGRES_HOST must be configured for production migrations.",
  );
}

export default defineConfig({
  schema: [
    "./src/auth/auth-schema.ts",
    "./src/platform/audit/audit-schema.ts",
    "./src/platform/authorization/access-schema.ts",
    "./src/catalog/catalog-schema.ts",
    "./src/inventory/inventory-schema.ts",
    "./src/cart/cart-schema.ts",
    "./src/geography/geography-schema.ts",
    "./src/delivery/delivery-schema.ts",
    "./src/tax/tax-schema.ts",
    "./src/quote/quote-schema.ts",
  ],
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: [
    "identity",
    "audit",
    "access",
    "catalog",
    "inventory",
    "cart",
    "geography",
    "delivery",
    "tax",
    "quote",
  ],
  dbCredentials: {
    host: process.env.POSTGRES_HOST ?? "127.0.0.1",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: isProduction
      ? process.env.MIGRATION_POSTGRES_USER!
      : (process.env.POSTGRES_USER ?? ""),
    password: isProduction
      ? process.env.MIGRATION_POSTGRES_PASSWORD!
      : (process.env.POSTGRES_PASSWORD ?? ""),
    database: process.env.POSTGRES_DB ?? "",
    ssl: getPostgresSslOptions(),
  },
});
