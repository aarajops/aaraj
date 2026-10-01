import { getPostgresSslOptions } from "./postgres-ssl.js";

describe("getPostgresSslOptions", () => {
  it("leaves local PostgreSQL connections unencrypted", () => {
    expect(getPostgresSslOptions({ NODE_ENV: "development" })).toBe(false);
    expect(getPostgresSslOptions({ NODE_ENV: "test" })).toBe(false);
  });

  it("requires certificate verification in production", () => {
    expect(getPostgresSslOptions({ NODE_ENV: "production" })).toEqual({
      rejectUnauthorized: true,
    });
  });

  it("loads a configured CA and rejects unreadable or invalid certificates", () => {
    const readCa = vi.fn(() => Buffer.from("not a certificate"));
    expect(() =>
      getPostgresSslOptions(
        { NODE_ENV: "production", POSTGRES_SSL_CA_FILE: "/etc/db/ca.pem" },
        readCa,
      ),
    ).toThrow("POSTGRES_SSL_CA_FILE");
    expect(readCa).toHaveBeenCalledWith("/etc/db/ca.pem");
  });
});
