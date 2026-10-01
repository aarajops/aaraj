import { getClientIpOptions } from "./client-ip.js";

describe("getClientIpOptions", () => {
  it("does not add proxy trust to local development", () => {
    expect(getClientIpOptions({ NODE_ENV: "development" })).toBeUndefined();
  });

  it("requires one explicit production trust configuration", () => {
    expect(() => getClientIpOptions({ NODE_ENV: "production" })).toThrow(
      "exactly one",
    );
    expect(() =>
      getClientIpOptions({
        NODE_ENV: "production",
        BETTER_AUTH_IP_ADDRESS_HEADER: "x-real-ip",
        BETTER_AUTH_TRUSTED_PROXIES: "192.0.2.10",
      }),
    ).toThrow("exactly one");
  });

  it("uses only the explicitly trusted header or proxy list", () => {
    expect(
      getClientIpOptions({
        NODE_ENV: "production",
        BETTER_AUTH_IP_ADDRESS_HEADER: "CF-Connecting-IP",
      }),
    ).toEqual({ ipAddressHeaders: ["cf-connecting-ip"] });
    expect(
      getClientIpOptions({
        NODE_ENV: "production",
        BETTER_AUTH_TRUSTED_PROXIES: "192.0.2.10, 2001:db8::1",
      }),
    ).toEqual({ trustedProxies: ["192.0.2.10", "2001:db8::1"] });
  });

  it("rejects malformed proxy lists", () => {
    expect(() =>
      getClientIpOptions({
        NODE_ENV: "production",
        BETTER_AUTH_TRUSTED_PROXIES: "192.0.2.10,",
      }),
    ).toThrow("valid IP addresses");
    expect(() =>
      getClientIpOptions({
        NODE_ENV: "production",
        BETTER_AUTH_TRUSTED_PROXIES: "0.0.0.0/0",
      }),
    ).toThrow("must not trust every address");
  });
});
