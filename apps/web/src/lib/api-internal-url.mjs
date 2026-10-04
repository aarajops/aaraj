const localApiUrl = "http://localhost:3001";

export function getApiInternalUrl() {
  const value = process.env.API_INTERNAL_URL?.trim();
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error("API_INTERNAL_URL must be configured for production.");
  }

  const configuredUrl = value || localApiUrl;
  let url;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error("API_INTERNAL_URL must be a valid HTTP(S) origin.");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("API_INTERNAL_URL must be a valid HTTP(S) origin.");
  }

  return url.origin;
}
