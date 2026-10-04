import { expect, test } from "@playwright/test";

test("staff manages reusable size guides and apparel products safely", async ({
  page,
  context,
  baseURL,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Products", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("No products are published yet.")).toBeVisible();

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
  await page.goto("/staff/catalog/size-guides");
  await expect(
    page.getByRole("heading", { name: "Size guides", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("Guide name").fill("Aaraj Classic Tee");
  await page
    .getByLabel("Product category")
    .selectOption({ label: "Clothing / T-shirts" });
  await page.getByLabel("Fit (optional)").fill("Regular");
  await page.getByLabel("Enter measurements in").selectOption("in");
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
  await expect(page.getByRole("status")).toContainText("Size guide created.");
  await page.goto("/staff/catalog");
  await expect(
    page.getByRole("heading", { name: "Catalog management" }),
  ).toBeVisible();
  await page
    .getByLabel("Product category")
    .selectOption({ label: "Clothing / T-shirts" });
  await page.getByLabel("Fit (optional, for example Regular)").fill("Regular");
  await page.getByRole("button", { name: "Load 100 more size guides" }).click();
  await expect(
    page.locator("#product-size-guide option").filter({
      hasText: "Legacy guide beyond the first page",
    }),
  ).toHaveCount(1);
  await page.getByLabel("Name", { exact: true }).fill("Aaraj E2E Tee");
  await page.locator("#product-slug").fill("aaraj-e2e-tee");
  await page
    .getByLabel("Description", { exact: true })
    .fill("A test product used to verify the clothing catalog workflow.");
  await page.getByLabel("Audience").selectOption("unisex");
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
  const guideOptions = await page
    .locator("#product-size-guide option")
    .evaluateAll((options) =>
      options.map((option) => {
        const element = option as HTMLOptionElement;
        return { value: element.value, text: element.textContent ?? "" };
      }),
    );
  const selectedGuide = guideOptions.find((option) =>
    option.text.includes("Aaraj Classic Tee"),
  );
  expect(selectedGuide).toBeDefined();
  await page.locator("#product-size-guide").selectOption(selectedGuide!.value);
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
  await expect(page.getByRole("status")).toContainText(
    "Product created and published.",
  );
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  await expect(page.getByText("৳1,999", { exact: true })).toBeVisible();

  await page.goto("/");
  await page.getByLabel("Audience").selectOption("unisex");
  await page.getByLabel("Category").selectOption("t-shirts");
  await page.getByLabel("Color").selectOption("Black");
  await page.getByLabel("Size").selectOption("M");
  await expect(page.getByLabel("Audience")).toHaveValue("unisex");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/audience=unisex/);
  await expect(page).toHaveURL(/category=t-shirts/);
  await expect(page).toHaveURL(/color=Black/);
  await expect(page).toHaveURL(/size=M/);
  await expect(page.getByRole("link", { name: /Aaraj E2E Tee/ })).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/staff/catalog");

  await page.getByLabel("Name", { exact: true }).fill("Duplicate slug item");
  await page.locator("#product-slug").fill("aaraj-e2e-tee");
  await page.getByLabel("Audience").selectOption("unisex");
  await page
    .getByLabel("Product category")
    .selectOption({ label: "Clothing / T-shirts" });
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Check duplicate slug");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(
    page.getByText("That slug is already in use. Choose another one."),
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

  await page.goto("/staff/catalog");
  await page.getByLabel("Name", { exact: true }).fill("Aaraj E2E T-shirt");
  await page.locator("#product-slug").fill("aaraj-e2e-t-shirt");
  await page.getByLabel("Audience").selectOption("men");
  await page
    .getByLabel("Product category")
    .selectOption({ label: "Clothing / T-shirts" });
  await page.getByLabel("Fit (optional, for example Regular)").fill("Regular");
  await page.getByRole("button", { name: "Add variant" }).click();
  await page.getByLabel("Variant 1 SKU").fill("AA-TEE-WHT-M");
  await page.getByLabel("Variant 1 color").fill("White");
  await page.getByLabel("Variant 1 size").fill("M");
  await page.getByLabel("Variant 1 price in BDT").fill("1999");
  await page.locator("#product-size-guide").selectOption(selectedGuide!.value);
  await page.getByLabel("Published on the storefront").check();
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Create a second product");
  await page.getByRole("button", { name: "Create and publish" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Product created and published.",
  );

  await page.goto("/staff/catalog?limit=1&offset=0");
  await expect(
    page.locator('section[aria-labelledby="managed-products-heading"] li'),
  ).toHaveCount(1);
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/offset=1/);
  await expect(
    page.locator('section[aria-labelledby="managed-products-heading"] li'),
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

  await page.goto("/staff/catalog");
  await page.getByRole("button", { name: "Edit Aaraj E2E T-shirt" }).click();
  await page.getByLabel("Published on the storefront").uncheck();
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Unpublish second pagination item");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Product updated.");

  await page.goto("/staff/catalog");
  await page.getByRole("button", { name: "Edit Aaraj E2E Tee" }).click();
  await page.getByLabel("Published on the storefront").uncheck();
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Unpublish catalog test product");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Product updated.");
  await page.goto("/");
  await expect(page.getByText("No products are published yet.")).toBeVisible();
  const unpublishedResponse = await page.goto("/products/aaraj-e2e-tee");
  expect(unpublishedResponse?.status()).toBe(404);

  await page.goto("/staff/catalog/categories");
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
  await page.goto("/staff/catalog/categories");
  await page.getByLabel("Name", { exact: true }).fill("Accessories");
  await page.getByLabel("Slug").fill("accessories");
  await page
    .getByLabel("Reason for change")
    .fill("Add an independently managed category");
  await page.getByRole("button", { name: "Create category" }).click();
  await expect(page.getByRole("status")).toContainText("Category created.");
  await expect(
    page.getByRole("list").getByText("Accessories", { exact: true }),
  ).toBeVisible();
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
  await page.goto("/staff/catalog");
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
  await page.goto("/staff/catalog");
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
  await page.goto("/staff/catalog");
  await page.getByRole("button", { name: "Edit Aaraj E2E Tee" }).click();
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Verify recent sign-in recovery");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    "sign out, then sign back in to renew your 15-minute confirmation.",
  );
  await page.getByRole("link", { name: "Go to your account" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
});
