import "server-only";

export function getStorefrontOrigin(): string {
  const configured =
    process.env.CLIENT_URL ??
    (process.env.NODE_ENV === "production"
      ? undefined
      : "http://localhost:3000");
  if (!configured) {
    throw new Error("CLIENT_URL must be configured in production.");
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("CLIENT_URL must be a valid serialized origin.");
  }
  if (
    parsed.origin !== configured ||
    (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")
  ) {
    throw new Error(
      "CLIENT_URL must be an origin without a path and use HTTPS in production.",
    );
  }
  return configured;
}
