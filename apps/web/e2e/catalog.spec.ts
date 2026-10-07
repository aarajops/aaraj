import { expect, test } from "@playwright/test";
import type { CatalogMedia } from "@aaraj/contracts";
import { chooseSelectOption } from "./select";

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
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();

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
  await page.keyboard.press("Control+b");
  await expect(
    page.locator('[data-slot="sidebar"][data-state="collapsed"]'),
  ).toHaveCount(1);
  await page.reload();
  await expect(
    page.locator('[data-slot="sidebar"][data-state="collapsed"]'),
  ).toHaveCount(1);
});

test("staff manages reusable size guides and apparel products safely", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(60_000);

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Products", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("No products are published yet.")).toBeVisible();

  await page.goto(`/?search=${"x".repeat(161)}&audience=unisex`);
  await expect(page.getByRole("alert")).toContainText(
    "The search or filters in this URL are invalid.",
  );
  await expect(page.getByRole("link", { name: /Aaraj E2E/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Clear search and filters" }).click();

  const malformedSlug = await page.goto("/products/INVALID-SLUG");
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
  await chooseSelectOption(page, "Product category", "Clothing / T-shirts");
  await page.getByLabel("Fit (optional)").fill("Regular");
  await chooseSelectOption(page, "Enter measurements in", "Inches (in)");
  await page.getByRole("button", { name: "Add size" }).click();
  await page.getByRole("button", { name: "Add size" }).click();
  await page.locator("#size-label-0").fill("S");
  await page.locator("#size-0-chest_width").fill("20.000");
  await page.locator("#size-0-body_length").fill("28.000");
  await page.locator("#size-label-1").fill("M");
  await page.locator("#size-1-chest_width").fill("21.000");
  await page.locator("#size-1-body_length").fill("29.000");
  await page.getByLabel("Audit reason").fill("Create apparel size guide");
  await page.getByRole("button", { name: "Create guide" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/size-guides$/);
  await page.goto("/admin/catalog");
  await expect(
    page.getByRole("heading", { name: "Catalog management" }),
  ).toBeVisible();
  await page.goto("/admin/catalog/create");
  await chooseSelectOption(page, "Product category", "Clothing / T-shirts");
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
  await page.getByLabel("Variant 1 SKU").fill("AA-TEE-BLK-S");
  await page.getByLabel("Variant 1 color").fill("Black");
  await page.getByLabel("Variant 1 size").fill("S");
  await page.getByLabel("Variant 1 price in BDT").fill("1999");
  await page.getByRole("button", { name: "Add variant" }).click();
  await page.getByLabel("Variant 2 SKU").fill("AA-TEE-BLK-M");
  await page.getByLabel("Variant 2 color").fill("Black");
  await page.getByLabel("Variant 2 size").fill("M");
  await page.getByLabel("Variant 2 price in BDT").fill("2200");
  await chooseSelectOption(page, "Reusable size guide", /Aaraj Classic Tee/);
  await page.getByLabel("Published on the storefront").check();
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Publish apparel test product");
  await page.getByLabel("Variant 2 price in BDT").fill("2200.50");
  await page.getByRole("button", { name: "Create and publish" }).click();
  await expect(
    page.getByText("Enter each price as a whole BDT amount, for example 1999."),
  ).toBeVisible();
  await page.getByLabel("Variant 2 price in BDT").fill("2200");
  await page.getByRole("button", { name: "Create and publish" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  await expect(page.getByText("৳1,999", { exact: true })).toBeVisible();

  await page.goto("/");
  await chooseSelectOption(page, "Audience", "Unisex");
  await chooseSelectOption(page, "Category", "Clothing / T-shirts");
  await chooseSelectOption(page, "Color", "Black");
  await chooseSelectOption(page, "Size", "M");
  await page.getByLabel("Search products").fill("Aaraj E2E");
  await expect(page.getByRole("combobox", { name: "Audience" })).toHaveText(
    "Unisex",
  );
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/audience=unisex/);
  await expect(page).toHaveURL(/category=t-shirts/);
  await expect(page).toHaveURL(/color=Black/);
  await expect(page).toHaveURL(/size=M/);
  await expect(page).toHaveURL(/search=Aaraj\+E2E/);
  await expect(page.getByRole("link", { name: /Aaraj E2E Tee/ })).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/admin/catalog/create");

  await page.getByLabel("Name", { exact: true }).fill("Duplicate slug item");
  await page.locator("#product-slug").fill("aaraj-e2e-tee");
  await chooseSelectOption(page, "Audience", "Unisex");
  await chooseSelectOption(page, "Product category", "Clothing / T-shirts");
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Check duplicate slug");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(
    page.getByText("A product with this slug already exists"),
  ).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("link", { name: /Aaraj E2E Tee/ })).toBeVisible();
  await page.getByRole("link", { name: /Aaraj E2E Tee/ }).click();
  await expect(
    page.getByRole("heading", { name: "Aaraj E2E Tee", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("৳1,999", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "A test product used to verify the clothing catalog workflow.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Available colors and sizes")).toBeVisible();
  const publicVariants = page.locator(
    'section[aria-labelledby="available-variants-heading"]',
  );
  await expect(publicVariants.getByText("S", { exact: true })).toBeVisible();
  await expect(publicVariants.getByText("M", { exact: true })).toBeVisible();
  await expect(publicVariants).not.toContainText("৳");
  await expect(page.getByText("Size guide: Aaraj Classic Tee")).toBeVisible();
  await expect(page.getByText("50.8 / 20.0", { exact: true })).toBeVisible();
  await expect(page.getByText("71.1 / 28.0", { exact: true })).toBeVisible();

  await page.goto("/admin/catalog/create");
  await page.getByLabel("Name", { exact: true }).fill("Aaraj E2E T-shirt");
  await page.locator("#product-slug").fill("aaraj-e2e-t-shirt");
  await chooseSelectOption(page, "Audience", "Men");
  await chooseSelectOption(page, "Product category", "Clothing / T-shirts");
  await page.getByLabel("Fit (optional, for example Regular)").fill("Regular");
  await page.getByRole("button", { name: "Add variant" }).click();
  await page.getByLabel("Variant 1 SKU").fill("AA-TEE-WHT-M");
  await page.getByLabel("Variant 1 color").fill("White");
  await page.getByLabel("Variant 1 size").fill("M");
  await page.getByLabel("Variant 1 price in BDT").fill("1999");
  await chooseSelectOption(page, "Reusable size guide", /Aaraj Classic Tee/);
  await page.getByLabel("Published on the storefront").check();
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Create a second product");
  await page.getByRole("button", { name: "Create and publish" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);

  await page.goto("/admin/catalog?limit=1&offset=0");
  await expect(
    page.locator(
      'section[aria-labelledby="managed-products-heading"] tbody tr',
    ),
  ).toHaveCount(1);
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/offset=1/);
  await expect(
    page.locator(
      'section[aria-labelledby="managed-products-heading"] tbody tr',
    ),
  ).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Previous" })).toBeVisible();

  await page.goto("/?limit=1&offset=0&category=t-shirts");
  const publicProductName = page.locator("main ul li h2");
  await expect(publicProductName).toHaveCount(1);
  const firstPageProduct = await publicProductName.textContent();
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/offset=1/);
  await expect(page).toHaveURL(/category=t-shirts/);
  await expect(publicProductName).toHaveCount(1);
  await expect(publicProductName).not.toHaveText(firstPageProduct ?? "");
  await page.getByRole("link", { name: "Previous" }).click();
  await expect(page).toHaveURL(/offset=0/);

  await page.goto("/admin/catalog");
  await page.getByRole("link", { name: "Edit Aaraj E2E T-shirt" }).click();
  await page.getByLabel("Published on the storefront").uncheck();
  await page
    .getByRole("region", { name: "Edit product" })
    .getByLabel("Audit reason", { exact: true })
    .fill("Unpublish second pagination item");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);

  const mediaEditHref = await page
    .getByRole("link", { name: "Edit Aaraj E2E Tee" })
    .getAttribute("href");
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
  await page.route(
    "**/api/v1/catalog/products/manage/*/media**",
    async (route) => {
      const method = route.request().method();
      if (method === "GET") {
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
        const body = route.request().postDataJSON() as { reason: string };
        deleteAttempts += 1;
        if (deleteAttempts === 1) {
          mediaRows = [
            {
              ...mediaRows[0]!,
              status: "deleting",
              deletionReason: body.reason,
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
  await page.getByRole("link", { name: "Edit Aaraj E2E Tee" }).click();
  await expect(
    page.getByRole("heading", { name: "Product media" }),
  ).toBeVisible();
  await expect(
    page.getByText("Upload incomplete", { exact: true }),
  ).toBeVisible();
  const retryFile = page.getByLabel(
    "Choose original file to retry Front view of Aaraj E2E Tee",
  );
  const pngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWO4I+d2R86NAYUCAFJZB4Fg78ImAAAAAElFTkSuQmCC",
    "base64",
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
  await expect(page.getByText("Processed", { exact: true })).toBeVisible();
  await page
    .getByLabel("Deletion reason")
    .fill("Remove outdated product photo");
  await page.getByRole("button", { name: "Delete media" }).click();
  await expect(
    page.getByText("Deletion incomplete", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry deletion" }).click();
  await expect(
    page.getByText("No media has been uploaded for this product."),
  ).toBeVisible();

  await page.goto("/admin/catalog");
  await page.getByRole("link", { name: "Edit Aaraj E2E Tee" }).click();
  await page.getByLabel("Published on the storefront").uncheck();
  await page
    .getByRole("region", { name: "Edit product" })
    .getByLabel("Audit reason", { exact: true })
    .fill("Unpublish catalog test product");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);
  await page.goto("/");
  await expect(page.getByText("No products are published yet.")).toBeVisible();
  const unpublishedResponse = await page.goto("/products/aaraj-e2e-tee");
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
  await page
    .getByLabel("Reason for change")
    .fill("Add an independently managed category");
  await page.getByRole("button", { name: "Create category" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/categories$/);
  await expect(page.getByRole("row", { name: /Accessories/ })).toBeVisible();
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

  await context.clearCookies();
  await context.addCookies([
    {
      name: "aaraj-e2e-role",
      value: "staff-stale",
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/admin/catalog");
  await page.getByRole("link", { name: "Edit Aaraj E2E Tee" }).click();
  await page
    .getByRole("region", { name: "Edit product" })
    .getByLabel("Audit reason", { exact: true })
    .fill("Verify recent sign-in recovery");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    "Sign out and sign in again before retrying this action.",
  );
  await page.getByRole("link", { name: "Go to your account" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
});
