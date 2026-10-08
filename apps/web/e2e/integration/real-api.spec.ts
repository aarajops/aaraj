import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { chooseSelectOption } from "../select";

test("real browser session reaches the API through Next and respects roles", async ({
  page,
}) => {
  const homeResponse = await page.goto("/");
  expect(homeResponse).not.toBeNull();
  const nextHeaders = homeResponse!.headers();
  expect(nextHeaders["content-security-policy"]).toMatch(/nonce-/);
  expect(nextHeaders["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(nextHeaders["x-frame-options"]).toBe("DENY");
  expect(nextHeaders["x-content-type-options"]).toBe("nosniff");

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/account$/);

  await page.goto("/account");
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Name").fill("E2E Customer");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`e2e-${randomUUID()}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("CorrectHorseBattery1!");
  await page
    .locator("form")
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/account");
  await expect(page.getByText("Signed in as E2E Customer")).toBeVisible();

  const accessResponse = await page.request.get("/api/v1/access/me");
  expect(accessResponse.status()).toBe(200);
  expect(accessResponse.headers()["cache-control"]).toBe("no-store");
  expect(accessResponse.headers()["x-frame-options"]).toBe("DENY");
  expect(await accessResponse.json()).toMatchObject({
    roles: ["customer"],
  });

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/admin/catalog");
  await expect(
    page.getByRole("heading", { name: "Staff access required" }),
  ).toBeVisible();
});

test("catalog operator configures a product through to storefront visibility", async ({
  page,
}) => {
  test.setTimeout(60_000);

  const suffix = randomUUID().slice(0, 8);
  const guideName = `E2E guide ${suffix}`;
  const productName = `E2E tee ${suffix}`;
  const slug = `e2e-tee-${suffix}`;
  const skuSmall = `E2E-${suffix}-S`;
  const skuMedium = `E2E-${suffix}-M`;

  await page.goto("/account");
  await page
    .getByLabel("Email", { exact: true })
    .fill("catalog-e2e@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("CatalogE2E-Only-Password-2026!");
  await page
    .locator("form")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin$/);

  const accessResponse = await page.request.get("/api/v1/access/me");
  expect(accessResponse.status()).toBe(200);
  expect(await accessResponse.json()).toMatchObject({
    roles: expect.arrayContaining(["superadmin"]),
    permissions: expect.arrayContaining([
      "catalog.manage",
      "catalog.categories.manage",
    ]),
  });

  await page.goto("/account");
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/catalog/categories/create");
  await expect(
    page.getByRole("heading", { name: "Create category", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Clothing");
  await page.getByLabel("Slug").fill("clothing");
  await page.getByLabel("Reason for change").fill("Create clothing root");
  await page.getByRole("button", { name: "Create category" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/categories$/);
  await page.goto("/admin/catalog/categories/create");
  await page.getByLabel("Name", { exact: true }).fill("T-shirts");
  await page.getByLabel("Slug").fill("t-shirts");
  await chooseSelectOption(page, "Parent category", "Clothing");
  await page.getByLabel("Reason for change").fill("Create T-shirt category");
  await page.getByRole("button", { name: "Create category" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/categories$/);

  await page.goto("/admin/catalog/size-guides/create");
  await expect(
    page.getByRole("heading", { name: "Create size guide", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("Guide name").fill(guideName);
  await chooseSelectOption(page, "Product category", "Clothing / T-shirts");
  await page.getByLabel("Fit (optional)").fill("Regular");
  await chooseSelectOption(page, "Enter measurements in", "Inches (in)");
  await page.getByRole("button", { name: "Add size" }).click();
  await page.getByRole("button", { name: "Add size" }).click();
  await page.locator("#size-label-0").fill("S");
  await page.locator("#size-0-chest_width").fill("20");
  await page.locator("#size-0-body_length").fill("28");
  await page.locator("#size-label-1").fill("M");
  await page.locator("#size-1-chest_width").fill("21");
  await page.locator("#size-1-body_length").fill("29");
  await page.getByLabel("Audit reason").fill("Create integration size guide");
  await page.getByRole("button", { name: "Create guide" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/size-guides$/);
  await expect(
    page.getByRole("row", { name: new RegExp(guideName) }),
  ).toBeVisible();

  await page.goto("/admin/catalog/create");
  await expect(
    page.getByRole("heading", { name: "Create product", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(productName);
  await page.locator("#product-slug").fill(slug);
  await page
    .getByLabel("Description", { exact: true })
    .fill("A product configured in a real browser and database flow.");
  await chooseSelectOption(page, "Audience", "Unisex");
  await chooseSelectOption(page, "Product category", "Clothing / T-shirts");
  await page.getByLabel("Fit (optional, for example Regular)").fill("Regular");
  await page.getByLabel("Fabric composition").fill("100% cotton");
  await page.getByLabel("Care instructions").fill("Machine wash cold");

  await chooseSelectOption(page, "Reusable size guide", new RegExp(guideName));

  await page.getByRole("button", { name: "Add variant" }).click();
  await page.getByLabel("Variant 1 SKU").fill(skuSmall);
  await page.getByLabel("Variant 1 color").fill("Black");
  await page.getByLabel("Variant 1 size").fill("S");
  await page.getByLabel("Variant 1 price in BDT").fill("2450");
  await page.getByRole("button", { name: "Add variant" }).click();
  await page.getByLabel("Variant 2 SKU").fill(skuMedium);
  await page.getByLabel("Variant 2 color").fill("Black");
  await page.getByLabel("Variant 2 size").fill("M");
  await page.getByLabel("Variant 2 price in BDT").fill("2490");
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Create configured integration product draft");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);

  expect(
    (await page.request.get(`/api/v1/catalog/products/${slug}`)).status(),
  ).toBe(404);
  expect((await page.goto(`/products/${slug}`))?.status()).toBe(404);
  await page.goto("/");
  await expect(page.getByRole("link", { name: productName })).toHaveCount(0);

  await page.goto("/admin/catalog");
  await page.getByRole("link", { name: `Edit ${productName}` }).click();
  await expect(
    page.getByRole("heading", { name: "Edit product", level: 2 }),
  ).toBeVisible();
  const managedSkuFields = page.locator('input[aria-label$="SKU"]');
  await expect(managedSkuFields).toHaveCount(2);
  const managedSkus = await managedSkuFields.evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).value),
  );
  expect(managedSkus).toEqual(expect.arrayContaining([skuSmall, skuMedium]));
  await expect(
    page.getByRole("combobox", { name: "Reusable size guide" }),
  ).toContainText(guideName);
  await page.getByLabel("Published on the storefront").check();
  await page
    .getByRole("region", { name: "Edit product" })
    .getByLabel("Audit reason", { exact: true })
    .fill("Publish configured integration product");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);

  await page.goto("/");
  await chooseSelectOption(page, "Audience", "Unisex");
  await chooseSelectOption(page, "Category", "Clothing / T-shirts");
  await chooseSelectOption(page, "Color", "Black");
  await chooseSelectOption(page, "Size", "S");
  await page.getByLabel("Search products").fill("100% cotton");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/audience=unisex/);
  expect(new URL(page.url()).searchParams.get("search")).toBe("100% cotton");
  await expect(page.getByRole("link", { name: productName })).toBeVisible();
  await expect(page.getByText("৳2,450", { exact: true })).toBeVisible();

  const filteredProducts = await page.request.get(
    "/api/v1/catalog/products?audience=unisex&category=t-shirts&color=Black&size=S",
  );
  expect(filteredProducts.status()).toBe(200);
  expect((await filteredProducts.json()).products).toEqual(
    expect.arrayContaining([expect.objectContaining({ slug })]),
  );

  const unavailableVariant = await page.request.get(
    "/api/v1/catalog/products?color=White&size=S",
  );
  expect(unavailableVariant.status()).toBe(200);
  expect((await unavailableVariant.json()).products).toEqual([]);

  await page.getByRole("link", { name: "Clear filters" }).click();
  await page.getByRole("link", { name: productName }).click();
  await expect(
    page.getByRole("heading", { name: productName, level: 1 }),
  ).toBeVisible();

  await page.goto("/admin/inventory");
  await expect(
    page.getByRole("heading", { name: "Inventory", level: 1 }),
  ).toBeVisible();
  await page
    .getByRole("link", {
      name: `Adjust stock for ${productName}, Black, S`,
    })
    .click();
  await page.getByLabel("Units").fill("12");
  await page.getByLabel("Reason").fill("Receive integration test stock");
  await page.getByRole("button", { name: "Receive stock" }).click();
  await expect(page).toHaveURL(/\/admin\/inventory$/);
  const smallVariantAdjustmentLink = page.getByRole("link", {
    name: `Adjust stock for ${productName}, Black, S`,
  });
  await expect(
    page.getByRole("row").filter({ has: smallVariantAdjustmentLink }),
  ).toContainText("12");
  await page.goto(`/products/${slug}`);
  await expect(page.getByText("৳2,450", { exact: true })).toBeVisible();
  await expect(
    page.getByText("A product configured in a real browser and database flow."),
  ).toBeVisible();
  await expect(page.getByText("100% cotton")).toBeVisible();
  await expect(page.getByText("Machine wash cold")).toBeVisible();
  await expect(page.getByText("Available colors and sizes")).toBeVisible();
  const publicVariants = page.locator(
    'section[aria-labelledby="available-variants-heading"]',
  );
  await expect(publicVariants.getByText("S", { exact: true })).toBeVisible();
  await expect(publicVariants.getByText("M", { exact: true })).toBeVisible();
  await expect(publicVariants).not.toContainText("৳");
  await expect(page.getByText("Size guide: " + guideName)).toBeVisible();
  await expect(page.getByText("50.8 / 20.0", { exact: true })).toBeVisible();
  await expect(page.getByText("71.1 / 28.0", { exact: true })).toBeVisible();
  await expect(page.getByText(skuSmall)).toHaveCount(0);
  await expect(page.getByText(skuMedium)).toHaveCount(0);

  await page.goto("/admin");
  await page.locator("summary[aria-label^='Account menu for']").click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/account$/);

  let cartReadIsCorrupt = true;
  await page.route("**/api/v1/cart", async (route) => {
    if (route.request().method() === "GET" && cartReadIsCorrupt) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 500,
          message:
            "Your saved cart cannot be read. Clear it to start a fresh cart.",
          errorCode: "CART_DATA_INVALID",
        }),
      });
      return;
    }
    if (route.request().method() === "DELETE") cartReadIsCorrupt = false;
    await route.continue();
  });
  await page.goto(`/products/${slug}`);
  await page.getByLabel("Choose a color and size").selectOption({
    label: "Black · S",
  });
  await page.getByRole("button", { name: "Clear unreadable cart" }).click();
  await expect(
    page.getByRole("status").filter({
      hasText: "Your unreadable saved cart was cleared. Add this item again.",
    }),
  ).toBeVisible();
  expect(cartReadIsCorrupt).toBe(false);
  await page.unroute("**/api/v1/cart");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `${productName} added to your cart.` }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Cart, 1 item" })).toBeVisible();

  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "Your cart" })).toBeVisible();
  await expect(page.getByRole("link", { name: productName })).toBeVisible();

  const quoteSection = page.getByRole("region", { name: "Delivery and quote" });
  await page.getByLabel("Division").selectOption({ label: "ঢাকা বিভাগ" });
  await page.getByLabel("District").selectOption({ label: "ঢাকা জেলা" });
  await page.getByLabel("Recipient name").fill("Browser E2E Recipient");
  await page.getByLabel("Phone").fill("+8801712345678");
  await page.getByLabel("Area / locality").fill("Browser test locality");
  await quoteSection
    .getByRole("button", { name: "Get delivery quote" })
    .click();
  await expect(
    quoteSection.getByRole("heading", { name: "Current quote" }),
  ).toBeVisible();
  await expect(
    quoteSection.getByText("Delivery · AARAJ_DELIVERY_2026_10_07_V1"),
  ).toBeVisible();
  await expect(quoteSection.getByText("৳80", { exact: true })).toBeVisible();

  await page.getByLabel("Division").selectOption({ label: "চট্টগ্রাম বিভাগ" });
  await page.getByLabel("District").selectOption({ label: "চট্টগ্রাম জেলা" });
  await expect(
    quoteSection
      .getByRole("status")
      .filter({ hasText: "This quote is no longer current." }),
  ).toBeVisible();
  await page.getByLabel("Division").selectOption({ label: "ঢাকা বিভাগ" });
  await page.getByLabel("District").selectOption({ label: "ঢাকা জেলা" });
  await expect(
    quoteSection.getByRole("heading", { name: "Current quote" }),
  ).toBeVisible();

  await page
    .getByLabel(`Quantity for ${productName}, Black, S`)
    .selectOption("2");
  await expect(
    page.getByLabel(`Quantity for ${productName}, Black, S`),
  ).toHaveValue("2");
  await expect(
    quoteSection
      .getByRole("status")
      .filter({ hasText: "This quote is no longer current." }),
  ).toBeVisible();
  await quoteSection
    .getByRole("button", { name: "Request updated quote" })
    .click();
  await expect(
    quoteSection.getByRole("heading", { name: "Current quote" }),
  ).toBeVisible();
  await expect(quoteSection.getByText("৳80", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel(`Quantity for ${productName}, Black, S`),
  ).toHaveValue("2");
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Your cart is empty.")).toBeVisible();

  await page.goto(`/products/${slug}`);
  await page.getByLabel("Choose a color and size").selectOption({
    label: "Black · S",
  });
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByRole("link", { name: "Cart, 1 item" })).toBeVisible();
  const browserStorage = await page.evaluate(() =>
    JSON.stringify({
      local: Object.fromEntries(
        Array.from({ length: localStorage.length }, (_, index) => {
          const key = localStorage.key(index)!;
          return [key, localStorage.getItem(key)];
        }),
      ),
      session: Object.fromEntries(
        Array.from({ length: sessionStorage.length }, (_, index) => {
          const key = sessionStorage.key(index)!;
          return [key, sessionStorage.getItem(key)];
        }),
      ),
    }),
  );
  expect(browserStorage).not.toContain(productName);
  expect(browserStorage.toLowerCase()).not.toContain("cart");

  await page.goto("/cart");
  await page.getByLabel("Division").selectOption({ label: "ঢাকা বিভাগ" });
  await page.getByLabel("District").selectOption({ label: "ঢাকা জেলা" });
  await page.getByLabel("Recipient name").fill("Guest Quote Recipient");
  await page.getByLabel("Phone").fill("+8801712345678");
  await page.getByLabel("Area / locality").fill("Guest quote locality");
  const guestQuoteResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/v1/quotes"),
  );
  await page
    .getByRole("region", { name: "Delivery and quote" })
    .getByRole("button", { name: "Get delivery quote" })
    .click();
  const guestQuoteResponse = await guestQuoteResponsePromise;
  expect(guestQuoteResponse.status()).toBe(201);
  const guestQuote = await guestQuoteResponse.json();

  await page.goto("/account");
  await page
    .getByLabel("Email", { exact: true })
    .fill("catalog-e2e@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("CatalogE2E-Only-Password-2026!");
  await page
    .locator("form")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/cart");
  await expect(page.getByRole("link", { name: productName })).toBeVisible();
  await expect(
    page.getByLabel(`Quantity for ${productName}, Black, S`),
  ).toHaveValue("1");

  const oldGuestQuoteQuery = new URLSearchParams({
    geographyVersion: guestQuote.destination.geographyVersion,
    divisionId: guestQuote.destination.divisionId,
    districtId: guestQuote.destination.districtId,
  });
  expect(
    (
      await page.request.get(
        `/api/v1/quotes/${guestQuote.id}?${oldGuestQuoteQuery}`,
      )
    ).status(),
  ).toBe(404);

  await page.getByLabel("Division").selectOption({ label: "ঢাকা বিভাগ" });
  await page.getByLabel("District").selectOption({ label: "ঢাকা জেলা" });
  await page.getByLabel("Recipient name").fill("Customer Quote Recipient");
  await page.getByLabel("Phone").fill("+8801712345678");
  await page.getByLabel("Area / locality").fill("Customer quote locality");
  const customerQuoteResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/v1/quotes"),
  );
  await quoteSection
    .getByRole("button", { name: "Get delivery quote" })
    .click();
  const customerQuoteResponse = await customerQuoteResponsePromise;
  expect(customerQuoteResponse.status()).toBe(201);
  await expect(
    quoteSection.getByRole("heading", { name: "Current quote" }),
  ).toBeVisible();
  await expect(quoteSection.getByText("৳80", { exact: true })).toBeVisible();

  const publicResponse = await page.request.get(
    `/api/v1/catalog/products/${slug}`,
  );
  expect(publicResponse.status()).toBe(200);
  const publicProduct = await publicResponse.json();
  expect(publicProduct.variants).toHaveLength(2);
  expect(publicProduct.price).toEqual({ amountBdt: 2450 });
  expect(publicProduct.variants).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ color: "Black", sizeLabel: "S" }),
      expect.objectContaining({ color: "Black", sizeLabel: "M" }),
    ]),
  );
  for (const variant of publicProduct.variants) {
    expect(variant).not.toHaveProperty("sku");
    expect(variant).not.toHaveProperty("price");
  }

  await page.goto("/admin/catalog");
  await page.getByRole("link", { name: `Edit ${productName}` }).click();
  await page.getByLabel("Published on the storefront").uncheck();
  await page
    .getByRole("region", { name: "Edit product" })
    .getByLabel("Audit reason", { exact: true })
    .fill("Unpublish integration test product");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);

  expect(
    (await page.request.get(`/api/v1/catalog/products/${slug}`)).status(),
  ).toBe(404);
  expect((await page.goto(`/products/${slug}`))?.status()).toBe(404);
  await page.goto("/");
  await expect(page.getByRole("link", { name: productName })).toHaveCount(0);
});
