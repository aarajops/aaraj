import { expect, test } from "@playwright/test";

test("staff manages drafts and only published products appear publicly", async ({
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

  await page.goto("/");
  await context.addCookies([
    {
      name: "aaraj-e2e-role",
      value: "staff",
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/staff/catalog");
  await expect(
    page.getByRole("heading", { name: "Catalog management" }),
  ).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill("Aaraj E2E Lamp");
  await page.locator("#product-slug").fill("aaraj-e2e-lamp");
  await page
    .getByLabel("Description", { exact: true })
    .fill("A test product used to verify the catalog workflow.");
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Initial catalog draft");
  await page.getByRole("button", { name: "Create draft" }).click();

  await expect(page.getByRole("status")).toContainText(
    "Draft product created.",
  );
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill("Duplicate lamp");
  await page.locator("#product-slug").fill("aaraj-e2e-lamp");
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Check duplicate slug");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(
    page.getByText("That slug is already in use. Choose another one."),
  ).toBeVisible();

  await page.goto("/");
  await expect(page.getByText("Aaraj E2E Lamp")).toHaveCount(0);
  const draftResponse = await page.goto("/products/aaraj-e2e-lamp");
  expect(draftResponse?.status()).toBe(404);

  await page.goto("/staff/catalog");
  await page.getByRole("button", { name: "Edit Aaraj E2E Lamp" }).click();
  await page.getByLabel("Published on the storefront").check();
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Publish catalog item");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Product updated.");

  await page.goto("/");
  await page.getByRole("link", { name: /Aaraj E2E Lamp/ }).click();
  await expect(
    page.getByRole("heading", { name: "Aaraj E2E Lamp", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText("A test product used to verify the catalog workflow."),
  ).toBeVisible();

  await page.goto("/staff/catalog");
  await page.getByLabel("Name", { exact: true }).fill("Aaraj E2E Mug");
  await page.locator("#product-slug").fill("aaraj-e2e-mug");
  await page
    .getByLabel("Description", { exact: true })
    .fill("A second product used to verify catalog pagination.");
  await page.getByLabel("Published on the storefront").check();
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Create a second published catalog item");
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

  await page.goto("/?limit=1&offset=0");
  const publicProductName = page.locator("main ul li h2");
  await expect(publicProductName).toHaveCount(1);
  const firstPageProduct = await publicProductName.textContent();
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/offset=1/);
  await expect(publicProductName).toHaveCount(1);
  await expect(publicProductName).not.toHaveText(firstPageProduct ?? "");
  await page.getByRole("link", { name: "Previous" }).click();
  await expect(page).toHaveURL(/offset=0/);

  await page.goto("/staff/catalog");
  await page.getByRole("button", { name: "Edit Aaraj E2E Mug" }).click();
  await page.getByLabel("Published on the storefront").uncheck();
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Unpublish second pagination item");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Product updated.");

  await page.goto("/staff/catalog");
  await page.getByRole("button", { name: "Edit Aaraj E2E Lamp" }).click();
  await page.getByLabel("Published on the storefront").uncheck();
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Unpublish catalog item");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Product updated.");

  await page.goto("/");
  await expect(page.getByText("No products are published yet.")).toBeVisible();
  const unpublishedResponse = await page.goto("/products/aaraj-e2e-lamp");
  expect(unpublishedResponse?.status()).toBe(404);

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
  await page.getByRole("button", { name: "Edit Aaraj E2E Lamp" }).click();
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
