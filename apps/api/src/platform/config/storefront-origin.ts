export function getStorefrontOrigin(): string {
  const configured =
    process.env.CLIENT_URL ??
    (process.env.NODE_ENV === "production"
      ? undefined
      : "http://localhost:3000");
  if (!configured) {
    throw new Error("CLIENT_URL must be configured in production.");
  }
  const parsed = new URL(configured);
  if (parsed.origin !== configured) {
    throw new Error("CLIENT_URL must be a serialized origin without a path.");
  }
  return configured;
}
