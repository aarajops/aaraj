import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { createSecureContext } from "node:tls";
import type { PoolConfig } from "pg";

export type PostgresSslOptions = NonNullable<PoolConfig["ssl"]>;

export function getPostgresSslOptions(
  environment: NodeJS.ProcessEnv = process.env,
  readCa: (path: string) => Buffer = readFileSync,
): PostgresSslOptions {
  if (environment.NODE_ENV !== "production") return false;

  const caPath = environment.POSTGRES_SSL_CA_FILE?.trim();
  if (!caPath) return { rejectUnauthorized: true };

  try {
    const ca = readCa(caPath);
    const certificates = ca
      .toString("utf8")
      .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!certificates?.length) throw new Error("missing CA certificate");
    for (const certificate of certificates) {
      if (!new X509Certificate(certificate).ca) {
        throw new Error("certificate is not a CA");
      }
    }
    createSecureContext({ ca });
    return { ca, rejectUnauthorized: true };
  } catch {
    throw new Error(
      "POSTGRES_SSL_CA_FILE must point to a readable, valid PostgreSQL CA certificate.",
    );
  }
}
