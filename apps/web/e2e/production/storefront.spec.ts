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

  const crawlerResponse = await page.request.get("/", {
    headers: { "User-Agent": "facebookexternalhit/1.1" },
  });
  expect(crawlerResponse.status()).toBe(200);
  const crawlerHead =
    (await crawlerResponse.text()).match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? "";
  expect(crawlerHead).toBeTruthy();
  expect(crawlerHead).toContain("<title>Aaraj | Products</title>");
  expect(crawlerHead).toContain(
    '<meta name="description" content="Browse products from Aaraj."',
  );
  expect(crawlerHead).toContain('href="https://aaraj.invalid"');
  expect(crawlerHead).toContain(
    '<meta name="twitter:card" content="summary_large_image"',
  );
  expect(crawlerHead).toContain(
    '<meta name="twitter:image:alt" content="Aaraj logo"',
  );
  expect(crawlerHead).toContain('rel="manifest" href="/manifest.webmanifest"');
  expect(crawlerHead).toContain('rel="apple-touch-icon"');

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()["content-type"]).toContain("json");
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    id: "/",
    name: "Aaraj",
    short_name: "Aaraj",
    description: "Browse products from Aaraj.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fafafafa",
    theme_color: "#7b2220",
  });
  expect(manifest.icons).toEqual([
    expect.objectContaining({ src: "/icon/192", sizes: "192x192" }),
    expect.objectContaining({ src: "/icon/512", sizes: "512x512" }),
  ]);
  for (const icon of [...manifest.icons, { src: "/icon/64", sizes: "64x64" }]) {
    const response = await page.request.get(icon.src);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
    const image = await response.body();
    const expectedDimension = Number(icon.sizes.split("x")[0]);
    expect(image.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(image.readUInt32BE(16)).toBe(expectedDimension);
    expect(image.readUInt32BE(20)).toBe(expectedDimension);
  }

  const appleIconResponse = await page.request.get("/apple-icon");
  expect(appleIconResponse.status()).toBe(200);
  expect(appleIconResponse.headers()["content-type"]).toContain("image/png");
  const appleIcon = await appleIconResponse.body();
  expect(appleIcon.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect(appleIcon.readUInt32BE(16)).toBe(180);
  expect(appleIcon.readUInt32BE(20)).toBe(180);

  const fallbackImageUrl = crawlerHead
    .match(/<meta property="og:image" content="([^"]+)"/)?.[1]
    ?.replaceAll("&amp;", "&");
  expect(fallbackImageUrl).toBeTruthy();
  const parsedFallbackImageUrl = new URL(fallbackImageUrl!);
  expect(parsedFallbackImageUrl.origin).toBe("https://aaraj.invalid");
  expect(parsedFallbackImageUrl.pathname).toBe("/aaraj-social.png");
  const fallbackImageResponse = await page.request.get("/aaraj-social.png");
  expect(fallbackImageResponse.status()).toBe(200);
  expect(fallbackImageResponse.headers()["content-type"]).toContain(
    "image/png",
  );

  await expect(page.locator('header img[alt="Aaraj logo"]')).toHaveAttribute(
    "src",
    "/aaraj-logo.svg",
  );
  const bundledLogoResponse = await page.request.get("/aaraj-logo.svg");
  expect(bundledLogoResponse.status()).toBe(200);
  const bundledIconResponse = await page.request.get("/aaraj-icon.svg");
  expect(bundledIconResponse.status()).toBe(200);
  expect(bundledIconResponse.headers()["content-type"]).toContain(
    "image/svg+xml",
  );
  expect(bundledLogoResponse.headers()["content-type"]).toContain(
    "image/svg+xml",
  );

  const robotsResponse = await page.request.get("/robots.txt");
  expect(robotsResponse.status()).toBe(200);
  expect(await robotsResponse.text()).toContain(
    "Sitemap: https://aaraj.invalid/sitemap.xml",
  );
  const sitemapResponse = await page.request.get("/sitemap.xml");
  expect(sitemapResponse.status()).toBe(200);
  expect(await sitemapResponse.text()).toContain(
    "<loc>https://aaraj.invalid/</loc>",
  );

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

  const invalidProductResponse = await page.goto("/shop/products/INVALID-SLUG");
  expect(invalidProductResponse?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Page not found", level: 1 }),
  ).toBeVisible();

  const unknownCategoryResponse = await page.goto(
    "/shop/categories/nonexistent-category",
  );
  expect(unknownCategoryResponse?.status()).toBe(404);
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
  const productResponse = await page.goto("/shop/products/media-e2e-fixture");
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

  const productCrawlerResponse = await page.request.get(
    "/shop/products/media-e2e-fixture",
    { headers: { "User-Agent": "facebookexternalhit/1.1" } },
  );
  expect(productCrawlerResponse.status()).toBe(200);
  const productHead = (await productCrawlerResponse.text()).match(
    /<head>([\s\S]*?)<\/head>/,
  )?.[1];
  expect(productHead).toBeTruthy();
  expect(productHead).toContain(
    '<meta property="og:title" content="Media E2E fixture"',
  );
  expect(productHead).toContain(
    'href="https://aaraj.invalid/shop/products/media-e2e-fixture"',
  );
  expect(productHead).toContain(
    'property="og:image" content="https://aaraj.invalid/api/v1/catalog/media/',
  );
  expect(productHead).toContain(
    '<meta name="twitter:image:alt" content="A one-pixel product image used to verify media delivery."',
  );

  const response = await imageResponse;
  expect(new URL(response.url()).origin).toBe(new URL(page.url()).origin);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/webp");
  expect(response.headers()["cache-control"]).toBe("private, no-store");
});
