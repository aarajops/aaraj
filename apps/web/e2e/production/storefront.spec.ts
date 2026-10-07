import { expect, test } from "@playwright/test";

test("production storefront serves routes, rewrites, and the strict CSP", async ({
  page,
}) => {
  const homeResponse = await page.goto("/");
  expect(homeResponse?.status()).toBe(200);
  expect(await page.title()).toBe("Aaraj | Products");

  const headers = homeResponse!.headers();
  const contentSecurityPolicy = headers["content-security-policy"] ?? "";
  expect(contentSecurityPolicy).toMatch(/nonce-/);
  expect(contentSecurityPolicy).toContain("upgrade-insecure-requests");
  expect(contentSecurityPolicy).not.toMatch(/'unsafe-(eval|inline)'/);
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  const nonce = contentSecurityPolicy.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  expect(await homeResponse!.text()).toContain(`nonce="${nonce}"`);

  const healthResponse = await page.request.get("/api/health/ready");
  expect(healthResponse.status()).toBe(200);
  expect(await healthResponse.json()).toEqual({
    status: "ok",
    database: "ok",
    redis: "ok",
  });

  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Your account", level: 1 }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Aaraj | Your account");

  const invalidProductResponse = await page.goto("/products/INVALID-SLUG");
  expect(invalidProductResponse?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Page not found", level: 1 }),
  ).toBeVisible();

  const unknownRouteResponse = await page.goto("/unknown-route");
  expect(unknownRouteResponse?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Page not found", level: 1 }),
  ).toBeVisible();
});

test("production storefront renders processed media through the same-origin API rewrite", async ({
  page,
}) => {
  const imageResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.startsWith("/api/v1/catalog/media/");
  });
  const productResponse = await page.goto("/products/media-e2e-fixture");
  expect(productResponse?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Media E2E fixture", level: 1 }),
  ).toBeVisible();

  const image = page.getByRole("img", {
    name: "A one-pixel product image used to verify media delivery.",
  });
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBe(1);

  const response = await imageResponse;
  expect(new URL(response.url()).origin).toBe(new URL(page.url()).origin);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/webp");
  expect(response.headers()["cache-control"]).toBe("private, no-store");
});
