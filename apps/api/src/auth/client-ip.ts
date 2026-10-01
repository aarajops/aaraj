import { isIP } from "node:net";

export interface BetterAuthIpAddressOptions {
  ipAddressHeaders?: string[];
  trustedProxies?: string[];
}

export function getClientIpOptions(
  environment: NodeJS.ProcessEnv = process.env,
): BetterAuthIpAddressOptions | undefined {
  if (environment.NODE_ENV !== "production") return undefined;

  const header = environment.BETTER_AUTH_IP_ADDRESS_HEADER?.trim();
  const proxies = environment.BETTER_AUTH_TRUSTED_PROXIES?.trim();
  if (Boolean(header) === Boolean(proxies)) {
    throw new Error(
      "Production must configure exactly one of BETTER_AUTH_IP_ADDRESS_HEADER or BETTER_AUTH_TRUSTED_PROXIES.",
    );
  }

  if (header) {
    if (!/^[a-z0-9-]+$/i.test(header)) {
      throw new Error(
        "BETTER_AUTH_IP_ADDRESS_HEADER must be a valid HTTP header name.",
      );
    }
    return { ipAddressHeaders: [header.toLowerCase()] };
  }

  const trustedProxies = proxies!.split(",").map((address) => address.trim());
  if (trustedProxies.some((address) => !isValidProxyAddress(address))) {
    throw new Error(
      "BETTER_AUTH_TRUSTED_PROXIES must contain valid IP addresses or CIDRs and must not trust every address.",
    );
  }
  if (new Set(trustedProxies).size !== trustedProxies.length) {
    throw new Error("BETTER_AUTH_TRUSTED_PROXIES must not contain duplicates.");
  }

  return { trustedProxies };
}

function isValidProxyAddress(value: string): boolean {
  const [address, prefix, ...extra] = value.split("/");
  if (extra.length > 0 || !address) return false;
  const version = isIP(address);
  if (!version) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;
  const mask = Number(prefix);
  return mask > 0 && mask <= (version === 4 ? 32 : 128);
}
