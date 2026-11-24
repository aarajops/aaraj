import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { DEFAULT_LIST_PAGE_SIZE, type CatalogMedia } from "@aaraj/contracts";
import { chooseSelectOption } from "./select";

async function openProductActions(page: Page, productName: string) {
  const productRow = page.getByRole("row").filter({ hasText: productName });
  const actionsButton = productRow.getByRole("button", {
    name: /^Actions for products row \d+$/,
  });
  await expect(async () => {
    await actionsButton.click();
    await expect(actionsButton).toHaveAttribute("aria-expanded", "true", {
      timeout: 500,
    });
  }).toPass({ timeout: 10_000 });
}

async function openProductEdit(page: Page, productName: string) {
  await openProductActions(page, productName);
  await page.getByRole("menuitem", { name: "Edit product" }).click();
}

const productImageFixture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWO4I+d2R86NAYUCAFJZB4Fg78ImAAAAAElFTkSuQmCC",
  "base64",
);

async function uploadProductImage(page: Page, altText: string): Promise<void> {
  await page.getByLabel("Choose images").setInputFiles({
    name: "front.png",
    mimeType: "image/png",
    buffer: productImageFixture,
  });
  await page.getByLabel("Alt text for front.png").fill(altText);
  await page.getByRole("button", { name: "Upload images" }).click();
  await expect(page.getByText(altText, { exact: true })).toBeVisible();
}

test("admin sidebar follows permissions and closes after mobile navigation", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    {
      name: "aaraj-e2e-role",
      value: "staff",
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/catalog");
  const sidebarWrapper = page.locator('[data-slot="sidebar-wrapper"]');
  await expect(sidebarWrapper).toHaveAttribute("data-mobile", "true");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();

  await expect(
    page.locator('[data-slot="sidebar"][data-mobile="true"]'),
  ).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Administration" });
  await expect(
    navigation.getByRole("link", { name: "Categories" }),
  ).toHaveCount(0);
  await navigation.getByRole("link", { name: "Size guides" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/size-guides$/);
  await expect(
    page.locator('[data-slot="sidebar"][data-mobile="true"]'),
  ).not.toBeVisible();
  await page.goto("/admin");
  await expect(
    page.getByRole("link", { name: "Manage categories" }),
  ).toHaveCount(0);

  await context.clearCookies({ name: "aaraj-e2e-role" });
  await context.addCookies([
    {
      name: "aaraj-e2e-role",
      value: "admin",
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.reload();
  await expect(sidebarWrapper).toHaveAttribute("data-mobile", "true");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect(
    navigation.getByRole("link", { name: "Categories" }),
  ).toBeVisible();
  await navigation.getByRole("link", { name: "Categories" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/categories$/);
  await page.goto("/admin");
  await expect(
    page.getByRole("link", { name: "Manage categories" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(sidebarWrapper).toHaveAttribute("data-mobile", "false");
  const desktopSidebar = page.locator('[data-slot="sidebar"][data-state]');
  await expect(desktopSidebar).toBeVisible();
  await expect(desktopSidebar).toHaveAttribute("data-state", "expanded");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect(desktopSidebar).toHaveAttribute("data-state", "collapsed");
  await page.reload();
  await expect(desktopSidebar).toHaveAttribute("data-state", "collapsed");
});

test("staff manages reusable size guides and apparel products safely", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);

  await page.goto("/shop");
  await expect(
    page.getByRole("heading", { name: "Products", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No products are available yet" }),
  ).toBeVisible();

  await page.goto(`/shop?search=${"x".repeat(161)}&audience=unisex`);
  await expect(page.locator('p[role="alert"]')).toContainText(
    "The search or filters in this URL are invalid.",
  );
  await expect(page.getByRole("link", { name: /Aaraj E2E/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Clear search and filters" }).click();

  const malformedSlug = await page.goto("/shop/products/INVALID-SLUG");
  expect(malformedSlug?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Page not found", level: 1 }),
  ).toBeVisible();
  await page.goto("/");

  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Your account", level: 1 }),
  ).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();

  await context.addCookies([
    {
      name: "aaraj-e2e-role",
      value: "staff",
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/admin/catalog/size-guides/create");
  await expect(
    page.getByRole("heading", { name: "Create size guide", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("Guide name").fill("Aaraj Classic Tee");
  await page.getByRole("combobox", { name: "Guide category" }).click();
  await expect(
    page.getByRole("option", { name: "Clothing", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("option", { name: "Clothing / T-shirts", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("option", { name: "Sweatwear", exact: true }),
  ).toBeEnabled();
  await page.getByRole("option", { name: "Clothing", exact: true }).click();
  await page.getByLabel("Fit (optional)").fill("Regular");
  await page.getByRole("button", { name: "Add size" }).click();
  await page.getByRole("button", { name: "Add size" }).click();
  await page.locator("#size-label-0").fill("S");
  await page.locator("#size-0-chest_width").fill("20.0");
  await page.locator("#size-0-body_length").fill("28.0");
  await page.locator("#size-label-1").fill("M");
  await page.locator("#size-1-chest_width").fill("21.0");
  await page.locator("#size-1-body_length").fill("29.0");
  const secondSizeHandle = page.getByRole("button", {
    name: "Reorder size row 2",
  });
  await secondSizeHandle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
  await expect(page.getByLabel("Size label, row 1")).toHaveValue("M");
  await expect(page.getByLabel("Size label, row 2")).toHaveValue("S");
  await page.getByRole("button", { name: "Create guide" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/size-guides$/);
  const sizeGuideRow = page
    .getByRole("row")
    .filter({ hasText: "Aaraj Classic Tee" });
  await sizeGuideRow
    .getByRole("button", { name: /^Actions for size guides row \d+$/ })
    .click();
  await page.getByRole("menuitem", { name: "Edit size guide" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/size-guides\/.+\/edit$/);
  await expect(page.getByLabel("Size label, row 1")).toHaveValue("M");
  await expect(page.getByLabel("Size label, row 2")).toHaveValue("S");
  await expect(
    page.getByRole("columnheader", { name: "Chest width (in)" }),
  ).toBeVisible();
  await expect(page.locator("#size-0-chest_width")).toHaveValue("21");
  await expect(page.locator("#size-0-body_length")).toHaveValue("29");
  const guideEditId = new URL(page.url()).pathname.split("/").at(-2);
  if (!guideEditId) throw new Error("Size guide edit URL has no guide ID.");
  const staleGuidePattern = `**/api/v1/catalog/size-guides/${guideEditId}`;
  await page.route(staleGuidePattern, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 412,
      json: {
        statusCode: 412,
        message:
          "This size guide changed after you opened it. Reload the latest version before saving.",
      },
    });
  });
  await page.getByLabel("Guide name").fill("Aaraj Classic Tee stale edit");
  await page.getByRole("button", { name: "Save guide" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    "This size guide changed after you opened it.",
  );
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe(
      "Reload the latest size guide? Unsaved changes will be lost.",
    );
    void dialog.accept();
  });
  await page.getByRole("button", { name: "Reload latest size guide" }).click();
  await expect(page.getByLabel("Guide name")).toHaveValue("Aaraj Classic Tee");
  await page.unroute(staleGuidePattern);
  await page.goto("/admin/catalog");
  await expect(
    page.getByRole("heading", { name: "Products", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
  await page.goto("/admin/catalog/create");
  await page.getByRole("combobox", { name: "Product category" }).click();
  await expect(
    page.getByRole("option", { name: "Clothing", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("option", { name: "Clothing / T-shirts", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("option", { name: "Sweatwear", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("option", { name: "Clothing / T-shirts", exact: true })
    .click();
  await page.getByLabel("Fit (optional, for example Regular)").fill("Regular");
  await page.getByRole("button", { name: "Load 100 more size guides" }).click();
  await page.getByRole("combobox", { name: "Reusable size guide" }).click();
  await expect(
    page.getByRole("option", { name: /Legacy guide beyond the first page/ }),
  ).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.getByLabel("Name", { exact: true }).fill("Aaraj E2E Tee");
  await page.locator("#product-slug").fill("aaraj-e2e-tee");
  await page
    .getByLabel("Description", { exact: true })
    .fill("A test product used to verify the clothing catalog workflow.");
  await chooseSelectOption(page, "Audience", "Unisex");
  await page.getByRole("button", { name: "Add variant" }).click();
  await variantField(page, 1, "SKU").fill("AA-TEE-BLK-S");
  await variantField(page, 1, "Color").fill("Black");
  await variantField(page, 1, "Size").fill("S");
  await variantField(page, 1, "Selling price (BDT)").fill("1999");
  await page.getByRole("button", { name: "Add variant" }).click();
  await variantField(page, 2, "SKU").fill("AA-TEE-BLK-M");
  await variantField(page, 2, "Color").fill("Black");
  await variantField(page, 2, "Size").fill("M");
  await variantField(page, 2, "Selling price (BDT)").fill("2200");
  await chooseSelectOption(page, "Reusable size guide", /Aaraj Classic Tee/);
  await variantField(page, 2, "Selling price (BDT)").fill("2200.50");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(
    page.getByText("Enter each price as a whole BDT amount, for example 1999."),
  ).toBeVisible();
  await variantField(page, 2, "Selling price (BDT)").fill("2200");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);

  await openProductEdit(page, "Aaraj E2E Tee");
  const staleProductPattern = "**/api/v1/catalog/products/*";
  await page.route(staleProductPattern, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 412,
      json: {
        statusCode: 412,
        message:
          "This product changed after you opened it. Reload the latest version before saving.",
      },
    });
  });
  await page
    .getByLabel("Description", { exact: true })
    .fill("A stale description that must not replace the latest product.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    "This product changed after you opened it.",
  );
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe(
      "Reload the latest product? Unsaved changes will be lost.",
    );
    void dialog.accept();
  });
  await page.getByRole("button", { name: "Reload latest product" }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
    "A test product used to verify the clothing catalog workflow.",
  );
  await page.unroute(staleProductPattern);
  await uploadProductImage(page, "Front view of Aaraj E2E Tee");
  await page.getByLabel("Published on the storefront").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  await expect(page.getByText("৳1,999", { exact: true })).toBeVisible();

  await page.goto("/shop/products/aaraj-e2e-tee");
  await expect(
    page.getByText("Delivery & returns", { exact: true }),
  ).toHaveCount(0);

  await page.goto("/admin/catalog");
  const managedProducts = page.getByRole("main");
  await expect(
    managedProducts.getByRole("row", { name: /Aaraj E2E Tee/ }),
  ).toBeVisible();

  const productListPattern = "**/api/v1/catalog/products/manage?*";
  let refreshAttempts = 0;
  await page.route(productListPattern, async (route) => {
    refreshAttempts += 1;
    if (refreshAttempts === 1) {
      await route.fulfill({
        status: 503,
        json: {
          statusCode: 503,
          message: "Product refresh is temporarily unavailable.",
        },
      });
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Refresh products" }).click();
  const refreshAlert = managedProducts.getByRole("alert");
  await expect(refreshAlert).toContainText(
    "Product refresh is temporarily unavailable.",
  );
  await expect(refreshAlert).toContainText(
    "The product rows shown below may be outdated.",
  );
  await expect(
    managedProducts.getByRole("row", { name: /Aaraj E2E Tee/ }),
  ).toBeVisible();

  await refreshAlert
    .getByRole("button", { name: "Retry product refresh" })
    .click();
  await expect(refreshAlert).toHaveCount(0);
  await expect(
    managedProducts.getByRole("row", { name: /Aaraj E2E Tee/ }),
  ).toBeVisible();
  expect(refreshAttempts).toBe(2);

  await page.unroute(productListPattern);
  let overlappingRequests = 0;
  let releaseOlderRequest!: () => void;
  const olderRequestGate = new Promise<void>((resolve) => {
    releaseOlderRequest = resolve;
  });
  await page.route(productListPattern, async (route) => {
    overlappingRequests += 1;
    if (overlappingRequests === 1) {
      await olderRequestGate;
      await route.fulfill({
        status: 200,
        headers: { "x-e2e-response": "older" },
        json: {
          products: [],
          limit: DEFAULT_LIST_PAGE_SIZE,
          offset: 0,
          hasMore: false,
          nextOffset: null,
        },
      });
      return;
    }
    await route.continue();
  });

  const newerResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/catalog/products/manage?") &&
      response.status() === 200,
  );
  await page.evaluate(() => {
    const refreshButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Refresh products"]',
    );
    if (!refreshButton) throw new Error("Product refresh button was missing.");
    refreshButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    refreshButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect.poll(() => overlappingRequests).toBe(2);
  await newerResponse;
  await expect(
    page.getByRole("button", { name: "Refresh products" }),
  ).toBeEnabled();
  await expect(
    managedProducts.getByRole("row", { name: /Aaraj E2E Tee/ }),
  ).toBeVisible();

  const olderResponse = page.waitForResponse(
    async (response) =>
      response.url().includes("/api/v1/catalog/products/manage?") &&
      (await response.headerValue("x-e2e-response")) === "older",
  );
  releaseOlderRequest();
  await olderResponse;
  await expect(
    managedProducts.getByRole("row", { name: /Aaraj E2E Tee/ }),
  ).toBeVisible();
  await expect(refreshAlert).toHaveCount(0);
  await page.unroute(productListPattern);

  await page.goto("/");
  await chooseSelectOption(page, "Product category", "Clothing / T-shirts");
  const productFilters = page.locator('aside[aria-label="Product filters"]');
  const storefrontSearch = page.locator("header form").last();
  await storefrontSearch.getByRole("searchbox").fill("Aaraj E2E");
  await storefrontSearch.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/shop\/categories\/t-shirts/);
  await expect(page).toHaveURL(/search=Aaraj\+E2E/);
  await expect(page.getByText("From ৳1,999", { exact: true })).toBeVisible();
  await productFilters.getByRole("radio", { name: "Unisex" }).check();
  await expect(page).toHaveURL(/audience=unisex/);
  await productFilters.getByRole("checkbox", { name: "Black" }).check();
  await expect(page).toHaveURL(/color=Black/);
  await productFilters.getByRole("checkbox", { name: "M" }).check();
  await expect(page).toHaveURL(/size=M/);
  await expect(
    productFilters.getByRole("radio", { name: "Unisex" }),
  ).toBeChecked();
  await productFilters.getByRole("checkbox", { name: "S" }).check();
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll("size"))
    .toEqual(expect.arrayContaining(["M", "S"]));
  await expect(page).toHaveURL(/audience=unisex/);
  await expect(page).toHaveURL(/\/shop\/categories\/t-shirts/);
  await expect(page).toHaveURL(/color=Black/);
  const selectedSizes = new URL(page.url()).searchParams.getAll("size");
  expect(selectedSizes).toEqual(expect.arrayContaining(["M", "S"]));
  await expect(page).toHaveURL(/search=Aaraj\+E2E/);
  await expect(page.getByRole("link", { name: /Aaraj E2E Tee/ })).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(
    /\/shop\/categories\/t-shirts\?search=Aaraj\+E2E/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/shop/categories/t-shirts?search=Aaraj+E2E");
  await page.getByRole("button", { name: /Filters/ }).click();
  const mobileFilterSheet = page.getByRole("dialog", { name: "Filters" });
  await expect(mobileFilterSheet).toBeVisible();
  await mobileFilterSheet.getByRole("radio", { name: "Unisex" }).check();
  await expect(page).toHaveURL(/audience=unisex/);
  await mobileFilterSheet.getByRole("checkbox", { name: "Black" }).check();
  await expect(page).toHaveURL(/color=Black/);
  await mobileFilterSheet.getByRole("checkbox", { name: "S" }).check();
  await expect(page).toHaveURL(/size=S/);
  await mobileFilterSheet.getByRole("button", { name: "Close" }).click();
  await expect(mobileFilterSheet).not.toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin/catalog/create");

  let releaseSlugSuggestion!: () => void;
  let notifySlugSuggestionRequest!: () => void;
  const slugSuggestionRequest = new Promise<void>((resolve) => {
    notifySlugSuggestionRequest = resolve;
  });
  const slugSuggestionResponseGate = new Promise<void>((resolve) => {
    releaseSlugSuggestion = resolve;
  });
  const slugSuggestionPattern = "**/api/v1/catalog/products/slug-suggestion?*";
  await page.route(slugSuggestionPattern, async (route) => {
    notifySlugSuggestionRequest();
    await slugSuggestionResponseGate;
    await route.continue();
  });
  await page.getByLabel("Name", { exact: true }).fill("Duplicate slug item");
  await page.locator("#product-slug").fill("aaraj-e2e-tee");
  await slugSuggestionRequest;
  const slugSuggestionResponse = page.waitForResponse((response) =>
    response.url().includes("/api/v1/catalog/products/slug-suggestion?"),
  );
  releaseSlugSuggestion();
  await slugSuggestionResponse;
  await page.unroute(slugSuggestionPattern);
  await expect(page.locator("#product-slug")).toHaveValue("aaraj-e2e-tee");
  await chooseSelectOption(page, "Audience", "Unisex");
  await chooseSelectOption(page, "Product category", "Clothing / T-shirts");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(
    page.getByText("A product with this slug already exists"),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/shop");
  await expect(page.getByRole("link", { name: /Aaraj E2E Tee/ })).toBeVisible();
  await page.getByRole("link", { name: /Aaraj E2E Tee/ }).click();
  await expect(
    page.getByRole("heading", { name: "Aaraj E2E Tee", level: 1 }),
  ).toBeVisible();
  const startingPrice = "From ৳1,999";
  await expect(
    page.getByText(startingPrice, { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("Quick purchase actions")
      .getByText(startingPrice, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "A test product used to verify the clothing catalog workflow.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "S", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "M", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Color: Black")).toBeVisible();
  await page.getByRole("button", { name: "S", exact: true }).click();
  const selectedPrice = "৳1,999";
  await expect(
    page.getByText(selectedPrice, { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("Quick purchase actions")
      .getByText(selectedPrice, { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/color=Black/);
  await expect(page).toHaveURL(/size=S/);
  await expect(page.getByRole("heading", { name: "Size guide" })).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Use centimeters" }),
  ).toHaveCount(0);
  await expect(page.getByText("Chest", { exact: true })).toBeVisible();
  await expect(page.getByText("20", { exact: true })).toBeVisible();
  await expect(page.getByText("28", { exact: true })).toBeVisible();

  await page.goto("/admin/catalog/create");
  await page.getByLabel("Name", { exact: true }).fill("Aaraj E2E T-shirt");
  await page.locator("#product-slug").fill("aaraj-e2e-t-shirt");
  await chooseSelectOption(page, "Audience", "Men");
  await chooseSelectOption(page, "Product category", "Clothing / T-shirts");
  await page.getByLabel("Fit (optional, for example Regular)").fill("Regular");
  await page.getByRole("button", { name: "Add variant" }).click();
  await page
    .getByLabel("Description", { exact: true })
    .fill("A test product used to verify the clothing catalog workflow.");
  await variantField(page, 1, "SKU").fill("AA-TEE-WHT-M");
  await variantField(page, 1, "Color").fill("White");
  await variantField(page, 1, "Size").fill("M");
  await variantField(page, 1, "Selling price (BDT)").fill("1999");
  await chooseSelectOption(page, "Reusable size guide", /Aaraj Classic Tee/);
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);

  await openProductEdit(page, "Aaraj E2E T-shirt");
  await uploadProductImage(page, "Front view of Aaraj E2E T-shirt");
  await page.getByLabel("Published on the storefront").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);

  await page.goto("/admin/catalog?limit=1&offset=0");
  await expect(
    page.getByRole("table", { name: "Products" }).locator("tbody tr"),
  ).toHaveCount(1);
  await page.getByRole("link", { name: "Go to next page" }).click();
  await expect(page).toHaveURL(/offset=1/);
  await expect(
    page.getByRole("table", { name: "Products" }).locator("tbody tr"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "Go to previous page" }),
  ).toBeVisible();

  await page.goto("/?limit=1&offset=0&category=t-shirts");
  await expect(page).toHaveURL(
    /\/shop\/categories\/t-shirts\?limit=1&offset=0/,
  );
  const publicProductName = page.locator("main ul li h2");
  await expect(publicProductName).toHaveCount(1);
  const firstPageProduct = await publicProductName.textContent();
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/shop/categories/t-shirts" &&
      url.searchParams.get("sort") === "updated-descending" &&
      url.searchParams.get("limit") === "1" &&
      url.searchParams.get("offset") === "1",
  );
  await expect(publicProductName).toHaveCount(1);
  await expect(publicProductName).not.toHaveText(firstPageProduct ?? "");
  await page.getByRole("link", { name: "Previous" }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/shop/categories/t-shirts" &&
      url.searchParams.get("sort") === "updated-descending" &&
      url.searchParams.get("limit") === "1" &&
      url.searchParams.get("offset") === null,
  );

  await page.goto("/admin/catalog");
  await openProductEdit(page, "Aaraj E2E T-shirt");
  await page.getByLabel("Published on the storefront").uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);

  await openProductActions(page, "Aaraj E2E Tee");
  const mediaEditHref = await page
    .getByRole("menuitem", { name: "Edit product" })
    .getAttribute("href");
  await page.keyboard.press("Escape");
  if (!mediaEditHref) throw new Error("Product edit link has no href.");
  const mediaProductId = mediaEditHref.split("/").at(-2);
  if (!mediaProductId) throw new Error("Product edit link has no product ID.");
  const mediaRow: CatalogMedia = {
    id: "7a641e03-941b-4605-9a6c-5d97f9684cf7",
    commandId: "b3dd6b45-82ac-4bf4-88d9-7c76cb14e879",
    productId: mediaProductId,
    variantId: null,
    altText: "Front view of Aaraj E2E Tee",
    reason: "Recover interrupted media upload",
    deletionReason: null,
    contentType: "image/png",
    sizeBytes: 68,
    sortOrder: 0,
    status: "uploading",
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
  };
  let mediaRows: CatalogMedia[] = [mediaRow];
  let uploadAttempts = 0;
  let deleteAttempts = 0;
  const pngBuffer = productImageFixture;
  await page.route(
    "**/api/v1/catalog/products/manage/*/media**",
    async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        if (new URL(route.request().url()).pathname.endsWith("/preview")) {
          await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: pngBuffer,
          });
          return;
        }
        await route.fulfill({ status: 200, json: { media: mediaRows } });
        return;
      }
      if (method === "POST") {
        uploadAttempts += 1;
        if (uploadAttempts === 1) {
          await route.fulfill({
            status: 503,
            json: {
              statusCode: 503,
              message: "Storage is temporarily unavailable.",
              errorCode: "CATALOG_MEDIA_STORAGE_UNAVAILABLE",
            },
          });
          return;
        }
        mediaRows = [{ ...mediaRows[0]!, status: "ready" }];
        await route.fulfill({ status: 201, json: mediaRows[0] });
        return;
      }
      if (method === "DELETE") {
        expect(route.request().postDataJSON()).toEqual({});
        deleteAttempts += 1;
        if (deleteAttempts === 1) {
          mediaRows = [
            {
              ...mediaRows[0]!,
              status: "deleting",
              deletionReason: null,
            },
          ];
          await route.fulfill({
            status: 503,
            json: {
              statusCode: 503,
              message: "Storage is temporarily unavailable.",
              errorCode: "CATALOG_MEDIA_STORAGE_UNAVAILABLE",
            },
          });
          return;
        }
        mediaRows = [];
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      await route.fulfill({ status: 405 });
    },
  );

  await page.goto("/admin/catalog");
  await openProductEdit(page, "Aaraj E2E Tee");
  await expect(
    page.getByRole("heading", { name: "Product media" }),
  ).toBeVisible();
  await expect(
    page.getByText("Upload incomplete", { exact: true }),
  ).toBeVisible();
  const retryFile = page.getByLabel(
    "Choose original file to retry Front view of Aaraj E2E Tee",
  );
  await retryFile.setInputFiles({
    name: "front.png",
    mimeType: "image/png",
    buffer: pngBuffer,
  });
  await expect(
    page.getByRole("region", { name: "Product media" }).getByRole("alert"),
  ).toContainText("Storage is temporarily unavailable.");
  await retryFile.setInputFiles({
    name: "front.png",
    mimeType: "image/png",
    buffer: pngBuffer,
  });
  const uploadedPreview = page
    .getByRole("region", { name: "Product media" })
    .locator('img[src$="/preview"]');
  await expect(uploadedPreview).toBeVisible();
  await expect
    .poll(() =>
      uploadedPreview.evaluate(
        (image) => (image as HTMLImageElement).naturalWidth,
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Delete image 1" }).click();
  await expect(
    page.getByText("Deletion incomplete", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry deletion of image 1" }).click();
  await expect(
    page.getByText("No media has been uploaded for this product."),
  ).toBeVisible();

  await page.goto("/admin/catalog");
  await openProductEdit(page, "Aaraj E2E Tee");
  await page.getByLabel("Published on the storefront").uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);
  await page.goto("/shop");
  await expect(
    page.getByRole("heading", { name: "No products are available yet" }),
  ).toBeVisible();
  const unpublishedResponse = await page.goto("/shop/products/aaraj-e2e-tee");
  expect(unpublishedResponse?.status()).toBe(404);

  await page.goto("/admin/catalog/categories/create");
  await expect(
    page.getByRole("alert").filter({
      hasText: "Only administrators can manage product categories.",
    }),
  ).toBeVisible();
  await context.addCookies([
    {
      name: "aaraj-e2e-role",
      value: "admin",
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/admin/catalog/categories/create");
  await page.getByLabel("Name", { exact: true }).fill("Accessories");
  await page.getByLabel("Slug").fill("accessories");
  await page.getByRole("button", { name: "Create category" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/categories$/);
  await expect(page.getByRole("row", { name: /Accessories/ })).toBeVisible();
  const accessoriesRow = page
    .getByRole("row")
    .filter({ hasText: "Accessories" });
  await accessoriesRow
    .getByRole("button", {
      name: /^Actions for product categories row \d+$/,
    })
    .click();
  await page.getByRole("menuitem", { name: "Edit category" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Accessories stale edit");
  await page.route("**/api/v1/catalog/categories/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 412,
      json: {
        statusCode: 412,
        message:
          "This category changed after you opened it. Reload the latest version before saving.",
      },
    });
  });
  await page.getByRole("button", { name: "Save category" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    "This category changed after you opened it.",
  );
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe(
      "Reload the latest category? Unsaved changes will be lost.",
    );
    void dialog.accept();
  });
  await page.getByRole("button", { name: "Reload latest category" }).click();
  await expect(page.getByRole("row", { name: /Accessories/ })).toBeVisible();
  await expect(
    page.getByRole("row", { name: /Accessories stale edit/ }),
  ).toHaveCount(0);
  await context.addCookies([
    {
      name: "aaraj-e2e-role",
      value: "staff",
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  await context.clearCookies();
  await page.goto("/admin/catalog");
  await expect(
    page.getByRole("heading", { name: "Sign in to continue" }),
  ).toBeVisible();

  await context.addCookies([
    {
      name: "aaraj-e2e-role",
      value: "customer",
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/admin/catalog");
  await expect(
    page.getByText(
      "Your account does not have permission to manage the catalog.",
    ),
  ).toBeVisible();
});

test("combo option selections stay saved per color and the cart receives the chosen variants", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cartLoaded = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url().endsWith("/api/v1/cart"),
  );
  await page.goto("/shop/products/e2e-combo");
  await expect(
    page.getByRole("heading", { name: "E2E Color and Size Combo", level: 1 }),
  ).toBeVisible();
  expect((await cartLoaded).status()).toBe(200);
  await expect(page.getByText("Preparing your cart…")).toHaveCount(0);
  await expect(page.getByText("Loading your cart…")).toHaveCount(0);
  const colors = page.getByRole("group", { name: /^Color/ });
  await colors.getByRole("button", { name: "Choose color Navy" }).click();
  const fullZip = page.getByRole("region", { name: "Full Zip Jacket" });
  const sizeGrid = fullZip.locator(".grid").first();
  const visibleColumnCount = () =>
    sizeGrid.evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/)
          .length,
    );
  await expect.poll(visibleColumnCount).toBe(2);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(visibleColumnCount).toBe(4);
  await page.setViewportSize({ width: 390, height: 844 });
  const navyAdd = fullZip.getByRole("button", {
    name: "Add one Full Zip Jacket Navy size M",
  });
  await navyAdd.click();
  const navyRemove = fullZip.getByRole("button", {
    name: "Remove one Full Zip Jacket Navy size M",
  });
  await expect(navyRemove).toBeEnabled();
  await colors.getByRole("button", { name: "Choose color Olive" }).click();
  const halfZip = page.getByRole("region", { name: "Half Zip Jacket" });
  const oliveAdd = halfZip.getByRole("button", {
    name: "Add one Half Zip Jacket Olive size L",
  });
  await oliveAdd.click();
  await expect(
    halfZip.getByRole("button", {
      name: "Remove one Half Zip Jacket Olive size L",
    }),
  ).toBeEnabled();
  await expect(page.getByText("2 of 2 selected")).toBeVisible();
  await expect(
    colors.getByRole("button", { name: "Choose color Olive, 1 selected" }),
  ).toBeVisible();
  await colors
    .getByRole("button", { name: "Choose color Navy, 1 selected" })
    .click();
  await expect(navyRemove).toBeEnabled();
  await navyRemove.click();
  await expect(page.getByText("1 of 2 selected")).toBeVisible();
  await navyAdd.click();
  await expect(page.getByText("2 of 2 selected")).toBeVisible();
  await colors
    .getByRole("button", { name: "Choose color Olive, 1 selected" })
    .click();

  const addRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith("/api/v1/cart/combos"),
  );
  await page.getByRole("button", { name: "Add to cart" }).click();
  const request = await addRequest;
  expect(request.postDataJSON()).toMatchObject({
    productId: "00000000-0000-4000-8000-000000000303",
    comboRevision: 1,
    selections: [
      {
        componentId: "00000000-0000-4000-8000-000000000301",
        variantId: "00000000-0000-4000-8000-000000000311",
      },
      {
        componentId: "00000000-0000-4000-8000-000000000302",
        variantId: "00000000-0000-4000-8000-000000000322",
      },
    ],
  });
  await expect(page.getByText("Combo added to your cart.")).toBeVisible();
});

test("customer Order page explains cancellation", async ({ page }) => {
  const orderId = "b7e38a23-2ef7-49f0-a30f-8c25877e631e";
  await page.route(`**/api/v1/orders/${orderId}`, async (route) =>
    route.fulfill({
      status: 200,
      json: {
        id: orderId,
        reference: "ORD-026-00001",
        currency: "BDT",
        status: "cancelled",
        paymentMethod: "cod",
        collectionStatus: "uncollected",
        collectedAmountBdt: null,
        fulfillmentStatus: "cancelled",
        courierHandoff: null,
        lines: [
          {
            variantId: "0d8c92cf-d31c-4ca7-9c99-4aad8e103565",
            productName: "Test shirt",
            color: "Blue",
            sizeLabel: "M",
            quantity: 1,
            unitPriceBdt: 250,
            grossAmountBdt: 250,
          },
        ],
        merchandiseGrossBdt: 250,
        manualDiscountBdt: 0,
        delivery: {
          tariffVersion: "TEST_DELIVERY_V1",
          effectiveFrom: "2026-10-08",
          grossAmountBdt: 80,
        },
        totalBdt: 330,
        codAmountDueBdt: 330,
        cancellationReason: "staff_cancelled",
        cancelledAt: "2026-10-08T12:00:00.000Z",
        address: {
          recipientName: "Test Recipient",
          phone: "+8801712345678",
          geographyVersion: "TEST_BD_V1",
          divisionId: "5a4cf93c-c6ed-4bcb-8f4a-73db80e4896d",
          divisionName: "Dhaka",
          districtId: "2a1dc97b-b8b4-47e3-a1db-1a5d2c7bcffc",
          districtName: "Dhaka",
          upazilaId: null,
          upazilaName: null,
          doorstepDetails: "House 12, Road 5",
          street: null,
          house: null,
          postalCode: null,
          instructions: null,
        },
        createdAt: "2026-10-01T12:00:00.000Z",
        guestAccessExpiresAt: "2026-10-31T12:00:00.000Z",
      },
    }),
  );

  await page.goto(`/orders/${orderId}`);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "cancelled before courier pickup" }),
  ).toBeVisible();
  await expect(page.getByText("Nothing is payable")).toBeVisible();
});

function variantField(page: Page, index: number, label: string) {
  return page
    .getByRole("row", { name: `Variant ${index}` })
    .getByLabel(label, { exact: true });
}
