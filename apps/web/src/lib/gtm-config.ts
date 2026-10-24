const productionContainerId = "GTM-N28C5K72";

export function getGtmIdForRequestHost(requestHost: string | null) {
  if (process.env.NODE_ENV !== "production" || !requestHost) return undefined;

  const canonicalUrl = process.env.CLIENT_URL;
  if (!canonicalUrl) return undefined;

  try {
    const canonical = new URL(canonicalUrl);
    const request = new URL(`http://${requestHost}`);

    if (
      canonical.protocol !== "https:" ||
      canonical.hostname !== request.hostname
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return productionContainerId;
}
