import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { chooseSelectOption } from "../select";

async function openRowActions(page: Page, row: Locator) {
  const actionsButton = row.getByRole("button", {
    name: /^Actions for .+ row \d+$/,
  });
  await expect(async () => {
    await actionsButton.click();
    await expect(actionsButton).toHaveAttribute("aria-expanded", "true", {
      timeout: 500,
    });
  }).toPass({ timeout: 10_000 });
}

function variantField(page: Page, index: number, label: string) {
  return page
    .getByRole("row", { name: `Variant ${index}` })
    .getByLabel(label, { exact: true });
}

async function chooseAssetFile(
  page: Page,
  buttonName: string,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  await (await fileChooserPromise).setFiles(file);
}

const brandPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWO4I+d2R86NAYUCAFJZB4Fg78ImAAAAAElFTkSuQmCC",
  "base64",
);
const brandIconPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQImWNg+P8fhFAoAHedC/Wy/lr2AAAAAElFTkSuQmCC",
  "base64",
);

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
  const customerEmail = `e2e-${randomUUID()}@example.test`;
  await page.getByLabel("Email", { exact: true }).fill("not-an-email");
  await page
    .getByLabel("Password", { exact: true })
    .fill("CorrectHorseBattery1!");
  await page
    .locator("form")
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByText("Enter your name.")).toBeVisible();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await page.getByLabel("Name").fill("E2E Customer");
  await page.getByLabel("Email", { exact: true }).fill(customerEmail);
  await page
    .locator("form")
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/account");
  await expect(page.getByText("Signed in", { exact: true })).toBeVisible();
  await expect(page.getByText("Profile name: E2E Customer")).toBeVisible();
  await expect(page.getByText("Access roles: customer")).toHaveCount(0);

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

  await page.goto("/admin/settings/storefront");
  await expect(page).toHaveURL(/\/$/);
});

test("superadmin manages user access and repeatedly saves delivery tariffs", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const targetEmail = `user-admin-e2e-${randomUUID()}@example.test`;
  const targetPassword = "UserManagementE2E-Only-Password-2026!";
  const origin = "http://127.0.0.1:3180";
  const promotedContext = await browser.newContext({ baseURL: origin });
  const promotedPage = await promotedContext.newPage();

  try {
    await promotedPage.goto("/account");
    await promotedPage.getByRole("tab", { name: "Create account" }).click();
    await promotedPage.getByLabel("Name").fill("User Management E2E");
    await promotedPage.getByLabel("Email", { exact: true }).fill(targetEmail);
    await promotedPage
      .getByLabel("Password", { exact: true })
      .fill(targetPassword);
    await promotedPage
      .locator("form")
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(promotedPage).toHaveURL(/\/$/);

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
    await expect(
      page.getByRole("navigation", { name: "Access" }).getByRole("link", {
        name: "Users",
      }),
    ).toBeVisible();
    const roleCatalogResponse = await page.request.get("/api/v1/access/roles");
    expect(roleCatalogResponse.status()).toBe(200);
    const roleCatalog = (await roleCatalogResponse.json()) as {
      role: string;
      permissions: string[];
    }[];
    const getAssignedRoles = async () => {
      const response = await page.request.get(
        `/api/v1/access/users?search=${encodeURIComponent(targetEmail)}`,
      );
      expect(response.status()).toBe(200);
      return (await response.json()).users[0].roles as string[];
    };
    const roleLabelsAvailableFor = (assignedRoles: string[]) =>
      roleCatalog
        .filter(({ role }) => !assignedRoles.includes(role))
        .map(({ role }) => role.charAt(0).toLocaleUpperCase() + role.slice(1));

    await page.goto("/admin/users");
    await page
      .getByRole("searchbox", { name: "Search users" })
      .fill(targetEmail);
    await page.getByRole("button", { name: "Apply users search" }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("search"))
      .toBe(targetEmail);
    const targetRow = page.getByRole("row").filter({ hasText: targetEmail });
    await expect(targetRow).toBeVisible();
    await targetRow
      .getByRole("button", { name: /^Actions for users row \d+$/ })
      .click();
    await page.getByRole("menuitem", { name: "Manage access" }).click();
    const accessSheet = page.getByRole("dialog", { name: "Manage access" });
    const roleSelect = accessSheet.getByRole("combobox", {
      name: `Role to grant to ${targetEmail}`,
    });
    await expect(roleSelect).toHaveText("Choose a role");
    await roleSelect.click();
    const roleOptions = page.getByRole("option");
    const availableRoleLabels = roleLabelsAvailableFor(
      await getAssignedRoles(),
    );
    await expect(roleOptions).toHaveCount(availableRoleLabels.length);
    expect(await roleOptions.allTextContents()).toEqual(availableRoleLabels);
    await page.keyboard.press("Escape");
    await expect(
      accessSheet.getByRole("combobox", {
        name: `Role to grant to ${targetEmail}`,
      }),
    ).toHaveText("Choose a role");
    await roleSelect.click();
    await page.getByRole("option", { name: "Admin", exact: true }).click();
    await accessSheet
      .getByLabel(`Reason for changing roles for ${targetEmail}`)
      .fill("Approved E2E staff onboarding");
    await accessSheet
      .getByRole("button", { name: `Grant role to ${targetEmail}` })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: `admin access granted to ${targetEmail}` }),
    ).toBeVisible();
    await expect(targetRow.getByText("admin", { exact: true })).toBeVisible();

    await promotedPage.goto("/account");
    await expect(promotedPage).toHaveURL(/\/admin$/);
    await expect(promotedPage.getByText("Access: admin, customer")).toHaveCount(
      0,
    );
    await promotedPage.goto("/account");
    await expect(promotedPage).toHaveURL(/\/admin$/);
    await promotedPage.goto("/admin/users");
    await expect(
      promotedPage.getByRole("heading", {
        name: "Superadmin access required",
      }),
    ).toBeVisible();
    await expect(
      promotedPage.getByRole("navigation", { name: "Access" }),
    ).toHaveCount(0);
    await targetRow
      .getByRole("button", { name: /^Actions for users row \d+$/ })
      .click();
    await page.getByRole("menuitem", { name: "Manage access" }).click();
    const revokeSheet = page.getByRole("dialog", { name: "Manage access" });
    await expect(
      revokeSheet.getByRole("combobox", {
        name: `Role to grant to ${targetEmail}`,
      }),
    ).toHaveText("Choose a role");
    await revokeSheet
      .getByLabel(`Reason for changing roles for ${targetEmail}`)
      .fill("E2E access rollback");
    await revokeSheet.getByRole("button", { name: "Revoke admin" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: `admin access removed from ${targetEmail}` }),
    ).toBeVisible();
    const remainingAccess = await page.request.get(
      `/api/v1/access/users?search=${encodeURIComponent(targetEmail)}`,
    );
    expect(remainingAccess.status()).toBe(200);
    expect((await remainingAccess.json()).users[0].roles).toEqual(["customer"]);
    await expect(
      targetRow.getByText("customer", { exact: true }),
    ).toBeVisible();
    await promotedPage.goto("/admin");
    await expect(promotedPage).toHaveURL(/\/$/);

    await page.goto("/admin/settings/delivery");
    await expect(
      page.getByRole("heading", { name: "Delivery rates", level: 1 }),
    ).toBeVisible();
    await page.getByLabel("Inside Dhaka (৳)").fill("80");
    await page.getByLabel("Suburban (৳)").fill("110");
    await page.getByLabel("Outside Dhaka (৳)").fill("130");
    await chooseSelectOption(page, "Division", "ঢাকা বিভাগ");
    await chooseSelectOption(page, "District", "ঢাকা জেলা");
    await chooseSelectOption(page, "Zone", "Inside Dhaka");
    await page.getByRole("button", { name: "Add area rule" }).click();
    await page.getByLabel("Change reason").fill("Configure delivery rates");
    const firstSave = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/delivery/manage") &&
        response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Save delivery rates" }).click();
    expect((await firstSave).status()).toBe(200);
    await expect(
      page.getByText(
        "Delivery rates updated. New quotes will use them immediately.",
      ),
    ).toBeVisible();

    await page.getByLabel("Suburban (৳)").fill("111");
    await page.getByLabel("Change reason").fill("Update delivery rates");
    const secondSave = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/delivery/manage") &&
        response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Save delivery rates" }).click();
    expect((await secondSave).status()).toBe(200);
    await expect(
      page.getByText(
        "Delivery rates updated. New quotes will use them immediately.",
      ),
    ).toBeVisible();
  } finally {
    await promotedContext.close();
  }
});

test("admin updates public storefront settings through to the rendered header", async ({
  page,
}) => {
  test.setTimeout(120_000);

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

  const headerCategoryName = "Navigation E2E category";
  const headerCategorySlug = `navigation-e2e-${randomUUID().slice(0, 8)}`;
  const categoryResponse = await page.request.post(
    "/api/v1/catalog/categories",
    {
      data: {
        name: headerCategoryName,
        slug: headerCategorySlug,
        reason: "Create a category for storefront navigation E2E",
      },
      headers: { Origin: new URL(page.url()).origin },
    },
  );
  expect(categoryResponse.status()).toBe(201);

  const settingsNavigation = page.getByRole("navigation", {
    name: "Settings",
  });
  await expect(
    settingsNavigation.getByRole("link", { name: "Storefront" }),
  ).toBeVisible();

  await page.goto("/admin/settings/storefront");
  await expect(
    page.getByRole("heading", { name: "Storefront settings", level: 1 }),
  ).toBeVisible();

  const saveSettings = page.getByRole("button", {
    name: "Save changes",
  });
  await page.getByRole("tab", { name: "Store", exact: true }).click();
  const initialStoreName = await page.getByLabel("Store name").inputValue();
  await expect(saveSettings).toBeDisabled();
  await page.getByLabel("Store name").fill(`${initialStoreName} temporary`);
  await expect(saveSettings).toBeEnabled();
  await page.getByLabel("Store name").fill(initialStoreName);
  await expect(saveSettings).toBeDisabled();
  await page.getByRole("tab", { name: "Brand", exact: true }).click();
  await chooseAssetFile(page, "Choose store logo file", {
    name: "store-logo.png",
    mimeType: "image/png",
    buffer: brandPng,
  });
  await page.getByRole("button", { name: "Upload logo" }).click();
  await expect(page.getByText("Logo uploaded", { exact: true })).toBeVisible();

  const logoOnlySettings = await page.request
    .get("/api/v1/storefront/settings")
    .then((response) => response.json());
  expect(logoOnlySettings.logo).not.toBeNull();
  expect(logoOnlySettings.brandIcon).toBeNull();
  expect(logoOnlySettings.socialImage).toBeNull();
  const logoOnlyHome = await page.request.get("/", {
    headers: { "User-Agent": "facebookexternalhit/1.1" },
  });
  const logoOnlyHead = (await logoOnlyHome.text()).match(
    /<head>([\s\S]*?)<\/head>/,
  )?.[1];
  expect(logoOnlyHead).toBeTruthy();
  const logoOnlyShareImage = logoOnlyHead!.match(
    /<meta property="og:image" content="([^"]+)"/,
  )?.[1];
  expect(logoOnlyShareImage).toBeTruthy();
  expect(new URL(logoOnlyShareImage!).pathname).toBe(logoOnlySettings.logo.src);

  await chooseAssetFile(page, "Choose brand icon file", {
    name: "store-brand-icon.png",
    mimeType: "image/png",
    buffer: brandIconPng,
  });
  await page.getByRole("button", { name: "Upload icon" }).click();
  await expect(
    page.getByText("Brand icon uploaded", { exact: true }),
  ).toBeVisible();

  await chooseAssetFile(page, "Choose favicon file", {
    name: "store-favicon.png",
    mimeType: "image/png",
    buffer: brandPng,
  });
  await page.getByRole("button", { name: "Upload favicon" }).click();
  await expect(
    page.getByText("Favicon uploaded", { exact: true }),
  ).toBeVisible();

  await chooseAssetFile(page, "Choose social sharing image file", {
    name: "social-preview.png",
    mimeType: "image/png",
    buffer: brandPng,
  });
  await page.getByRole("button", { name: "Upload image" }).click();
  await expect(
    page.getByText("Social image uploaded", { exact: true }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Store", exact: true }).click();
  await page.getByLabel("Store name").fill("AARAJ Festive Edit");
  await page.getByRole("switch", { name: "Announcement banner" }).click();
  await page
    .getByLabel("Announcement text")
    .fill("Step into the festive season with AARAJ");
  await page.getByLabel("Customer support phone").fill("+8801712345678");
  await page.getByLabel("Customer support email").fill("help@aaraj.example");
  await page.getByLabel("Business address").fill("Dhaka, Bangladesh");
  await page.getByLabel("Instagram URL").fill("https://instagram.com/aaraj");

  await page.getByRole("tab", { name: "Brand", exact: true }).click();
  await page.getByLabel("Brand color").fill("#8c2b2b");
  await page.getByLabel("Background color").fill("#f8f8f8fa");

  await page.getByRole("tab", { name: "SEO", exact: true }).click();
  await page
    .getByLabel("Site title")
    .fill("AARAJ Festive Edit | Modern fashion");
  await page
    .getByLabel("Site description")
    .fill("Explore the latest AARAJ collection in Bangladesh.");
  await page
    .getByLabel("Social image description")
    .fill("AARAJ seasonal collection against a warm background");

  await page.getByRole("tab", { name: "Content", exact: true }).click();
  await page.getByRole("button", { name: "Add about us link" }).click();
  await page.locator("#footer-about-0-label").fill("Contact us");
  await page.locator("#footer-about-0-href").fill("/contact");
  await page
    .getByLabel("Footer description")
    .fill("Everyday style, thoughtfully selected.");
  await chooseSelectOption(page, "Add an active category", headerCategoryName);
  await expect(
    page.getByRole("combobox", { name: "Catalog category" }),
  ).toContainText(headerCategoryName);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("Storefront settings saved", { exact: true }),
  ).toBeVisible();

  const publicSettingsResponse = await page.request.get(
    "/api/v1/storefront/settings",
  );
  expect(publicSettingsResponse.status()).toBe(200);
  const configuredSettings = await publicSettingsResponse.json();
  expect(configuredSettings).toMatchObject({
    siteName: "AARAJ Festive Edit",
    brandColor: "#8c2b2b",
    backgroundColor: "#f8f8f8fa",
    seoTitle: "AARAJ Festive Edit | Modern fashion",
    seoDescription: "Explore the latest AARAJ collection in Bangladesh.",
    socialImageAlt: "AARAJ seasonal collection against a warm background",
    announcementEnabled: true,
    announcementText: "Step into the festive season with AARAJ",
    supportPhone: "+8801712345678",
    supportEmail: "help@aaraj.example",
    businessAddress: "Dhaka, Bangladesh",
    logo: {
      contentType: "image/webp",
      width: 2,
      height: 3,
    },
    brandIcon: {
      contentType: "image/png",
      width: 1024,
      height: 1024,
    },
    favicon: {
      contentType: "image/png",
      width: 64,
      height: 64,
    },
    socialImage: {
      contentType: "image/jpeg",
      width: 1200,
      height: 630,
    },
    socialLinks: {
      instagram: "https://instagram.com/aaraj",
    },
    headerNavigation: [
      {
        label: headerCategoryName,
        href: `/shop/categories/${headerCategorySlug}`,
      },
    ],
    footerDescription: "Everyday style, thoughtfully selected.",
    footerLinks: [{ label: "Contact us", href: "/contact" }],
    footerLinkGroups: {
      about: [{ label: "Contact us", href: "/contact" }],
      policies: [],
    },
    footerCategoryIds: [],
  });
  const brandIconResponse = await page.request.get(
    configuredSettings.brandIcon.src,
  );
  expect(brandIconResponse.status()).toBe(200);
  expect(brandIconResponse.headers()["content-type"]).toContain("image/png");
  const appIconCenterPixel = await page.evaluate(async () => {
    const image = new Image();
    image.src = "/icon/192";
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 192;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas context is unavailable.");
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(96, 96, 1, 1).data);
  });
  expect(appIconCenterPixel).toEqual([0, 255, 255, 255]);

  const configuredManifestResponse = await page.request.get(
    "/manifest.webmanifest",
  );
  expect(configuredManifestResponse.status()).toBe(200);
  expect(await configuredManifestResponse.json()).toMatchObject({
    background_color: "#f8f8f8fa",
    theme_color: "#8c2b2b",
  });

  await page.goto("/");
  await expect(page.locator("header")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("header")
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue("--background").trim(),
        ),
    )
    .toBe("#f8f8f8fa");
  await expect
    .poll(() =>
      page
        .locator("header")
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue("--brand").trim(),
        ),
    )
    .toBe("#8c2b2b");

  for (const [pathname, dimension] of [
    ["/icon/64", 64],
    ["/icon/192", 192],
    ["/apple-icon", 180],
  ] as const) {
    const iconResponse = await page.request.get(pathname);
    expect(iconResponse.status()).toBe(200);
    expect(iconResponse.headers()["content-type"]).toContain("image/png");
    const icon = await iconResponse.body();
    expect(icon.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(icon.readUInt32BE(16)).toBe(dimension);
    expect(icon.readUInt32BE(20)).toBe(dimension);
  }

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.status()).toBe(200);
  expect(await manifestResponse.json()).toMatchObject({
    name: "AARAJ Festive Edit",
    short_name: "AARAJ Festiv",
    description: "Explore the latest AARAJ collection in Bangladesh.",
  });

  await page.goto("/");
  await expect(
    page.getByRole("complementary", { name: "Store announcement" }),
  ).toHaveText("Step into the festive season with AARAJ");
  await expect(
    page.getByRole("banner").getByRole("link", {
      name: "AARAJ Festive Edit home",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Call us: +8801712345678" }),
  ).toHaveAttribute("href", "tel:+8801712345678");
  await expect(
    page.getByRole("link", { name: headerCategoryName, exact: true }),
  ).toHaveAttribute("href", `/shop/categories/${headerCategorySlug}`);
  await expect(
    page.locator('header img[alt="AARAJ Festive Edit logo"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "help@aaraj.example" }),
  ).toHaveAttribute("href", "mailto:help@aaraj.example");
  await expect(page.getByText("Dhaka, Bangladesh")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Contact us", exact: true }),
  ).toHaveAttribute("href", "/contact");
  await expect(
    page.getByRole("link", { name: "Instagram", exact: true }),
  ).toHaveAttribute("href", "https://instagram.com/aaraj");
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute(
    "href",
    /icon/,
  );
  const iconHref = await page
    .locator('link[rel="icon"]')
    .first()
    .getAttribute("href");
  const iconResponse = await page.request.get(
    new URL(iconHref!, page.url()).toString(),
  );
  expect(iconResponse.status()).toBe(200);
  expect(iconResponse.headers()["content-type"]).toContain("image/png");
  const appleIconHref = await page
    .locator('link[rel="apple-touch-icon"]')
    .getAttribute("href");
  expect(appleIconHref).toBeTruthy();
  const appleIconResponse = await page.request.get(
    new URL(appleIconHref!, page.url()).toString(),
  );
  expect(appleIconResponse.status()).toBe(200);
  expect(appleIconResponse.headers()["content-type"]).toContain("image/png");
  for (const size of [192, 512]) {
    const appIconResponse = await page.request.get(`/icon/${size}`);
    expect(appIconResponse.status()).toBe(200);
    expect(appIconResponse.headers()["content-type"]).toContain("image/png");
  }

  const socialImage = (await publicSettingsResponse.json()).socialImage;
  const socialImageResponse = await page.request.get(socialImage.src);
  expect(socialImageResponse.status()).toBe(200);
  expect(socialImageResponse.headers()["content-type"]).toContain("image/jpeg");

  const homeSeoResponse = await page.request.get("/", {
    headers: { "User-Agent": "facebookexternalhit/1.1" },
  });
  expect(homeSeoResponse.status()).toBe(200);
  const homeHtml = await homeSeoResponse.text();
  const homeHead = homeHtml.match(/<head>([\s\S]*?)<\/head>/)?.[1];
  expect(homeHead).toBeTruthy();
  expect(homeHead).toContain(
    "<title>AARAJ Festive Edit | Modern fashion</title>",
  );
  expect(homeHead).toContain(
    '<meta name="description" content="Explore the latest AARAJ collection in Bangladesh."',
  );
  expect(homeHead).toContain(
    '<meta property="og:title" content="AARAJ Festive Edit | Modern fashion"',
  );
  expect(homeHead).toContain(
    '<meta property="og:description" content="Explore the latest AARAJ collection in Bangladesh."',
  );
  expect(homeHead).toContain(
    '<meta property="og:image:alt" content="AARAJ seasonal collection against a warm background"',
  );
  expect(homeHead).toContain(
    '<meta name="twitter:image:alt" content="AARAJ seasonal collection against a warm background"',
  );
  expect(homeHead).toContain(
    '<meta name="twitter:card" content="summary_large_image"',
  );
  expect(homeHead).toContain('rel="canonical" href="http://127.0.0.1:3180"');
  expect(homeHead).toContain(
    `property="og:image" content="http://127.0.0.1:3180${socialImage.src}"`,
  );
  for (const path of [
    "/account",
    "/cart",
    "/checkout",
    "/admin/settings/storefront",
  ]) {
    const privateResponse = await page.request.get(path, {
      headers: { "User-Agent": "facebookexternalhit/1.1" },
    });
    const privateHead = (await privateResponse.text()).match(
      /<head>([\s\S]*?)<\/head>/,
    )?.[1];
    expect(
      privateHead,
      `${path} should render metadata in the head`,
    ).toBeTruthy();
    expect(privateHead).toContain('name="robots" content="noindex, nofollow"');
  }
});

test("admin uploads and publishes a catalog banner through to the storefront", async ({
  page,
}) => {
  test.setTimeout(120_000);

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

  await page.goto("/admin/storefront/banners");
  await expect(
    page.getByRole("heading", { name: "Storefront banners", level: 1 }),
  ).toBeVisible();
  await page.getByRole("link", { name: "New banner" }).click();
  await expect(
    page.getByRole("heading", { name: "Create banner", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("Internal name").fill("Seasonal banner");
  await page.locator("#banner-desktop-file").setInputFiles({
    name: "catalog-banner.png",
    mimeType: "image/png",
    buffer: brandPng,
  });
  await expect(
    page.getByRole("status").filter({
      hasText: "Desktop image uploaded. Save the banner to keep the change.",
    }),
  ).toBeVisible();
  await page.locator("#banner-mobile-file").setInputFiles({
    name: "catalog-banner-mobile.png",
    mimeType: "image/png",
    buffer: brandPng,
  });
  await expect(
    page.getByRole("status").filter({
      hasText: "Mobile image uploaded. Save the banner to keep the change.",
    }),
  ).toBeVisible();
  await page.getByLabel("Link (optional)").fill("/shop");
  await page.getByRole("checkbox", { name: "Publish this banner" }).check();
  await page.getByRole("button", { name: "Create banner" }).click();
  await expect(
    page.getByText("Add alternative text that describes the linked banner."),
  ).toBeVisible();
  await page.getByLabel("Alternative text").fill("AARAJ seasonal collection");
  await page.getByRole("button", { name: "Create banner" }).click();
  await expect(page).toHaveURL(/\/admin\/storefront\/banners$/);
  await expect(
    page.getByRole("row", { name: /Seasonal banner.*Published/ }),
  ).toBeVisible();
  await openRowActions(
    page,
    page.getByRole("row", { name: /Seasonal banner.*Published/ }),
  );
  await page.getByRole("menuitem", { name: "Edit banner" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit banner", level: 1 }),
  ).toBeVisible();
  await expect(page.getByLabel("Internal name")).toHaveValue("Seasonal banner");
  await expect(
    page.getByRole("checkbox", { name: "Publish this banner" }),
  ).toBeChecked();
  await page.getByLabel("Internal name").fill("Seasonal banner revised");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/admin\/storefront\/banners$/);
  await expect(
    page.getByRole("row", { name: /Seasonal banner revised.*Published/ }),
  ).toBeVisible();

  await page.getByRole("link", { name: "New banner" }).click();
  await page.getByLabel("Internal name").fill("Second seasonal banner");
  await page.locator("#banner-desktop-file").setInputFiles({
    name: "catalog-banner-second.png",
    mimeType: "image/png",
    buffer: brandPng,
  });
  await expect(
    page.getByRole("status").filter({
      hasText: "Desktop image uploaded. Save the banner to keep the change.",
    }),
  ).toBeVisible();
  await page
    .getByLabel("Alternative text")
    .fill("AARAJ second seasonal collection");
  await page.getByRole("checkbox", { name: "Publish this banner" }).check();
  await page.getByRole("button", { name: "Create banner" }).click();
  await expect(page).toHaveURL(/\/admin\/storefront\/banners$/);
  await expect(
    page.getByRole("row", { name: /Second seasonal banner.*Published/ }),
  ).toBeVisible();

  const publicBannerResponse = await page.request.get(
    "/api/v1/storefront/banners/home_hero",
  );
  expect(publicBannerResponse.status()).toBe(200);
  const publicBanner = await publicBannerResponse.json();
  expect(publicBanner).toMatchObject({
    placement: "home_hero",
    banners: [
      {
        altText: "AARAJ second seasonal collection",
      },
      {
        altText: "AARAJ seasonal collection",
        href: "/shop",
        mobile: { id: expect.any(String) },
      },
    ],
  });
  const imageResponse = await page.request.get(
    publicBanner.banners[0].desktop.src,
  );
  expect(imageResponse.status()).toBe(200);
  expect(imageResponse.headers()["content-type"]).toContain("image/webp");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Next promotion" }).click();
  await expect(
    page.getByRole("img", { name: "AARAJ seasonal collection" }),
  ).toBeVisible();
  const mobileAssetId = publicBanner.banners[1].mobile.id as string;
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "AARAJ seasonal collection" })
        .evaluate((image) => (image as HTMLImageElement).currentSrc),
    )
    .toContain(mobileAssetId);
  await expect(
    page.getByRole("link", { name: "AARAJ seasonal collection" }),
  ).toHaveAttribute("href", "/shop");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Next promotion" }).click();
  await expect(page.getByText("Slide 2 of 2", { exact: true })).toBeVisible();

  await page.goto("/admin/storefront/banners");
  const secondBannerHandle = page.getByRole("button", {
    name: "Reorder Second seasonal banner",
  });
  const reorderResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/storefront/manage/banners/order") &&
      response.request().method() === "PATCH",
  );
  await secondBannerHandle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  expect((await reorderResponsePromise).status()).toBe(200);
  await expect(page.getByRole("row").nth(1)).toContainText(
    "Seasonal banner revised",
  );
  await expect(page.getByRole("row").nth(2)).toContainText(
    "Second seasonal banner",
  );

  const reorderedPublicBannerResponse = await page.request.get(
    "/api/v1/storefront/banners/home_hero",
  );
  expect(reorderedPublicBannerResponse.status()).toBe(200);
  const reorderedPublicBanner = await reorderedPublicBannerResponse.json();
  expect(
    reorderedPublicBanner.banners.map(
      (banner: { altText: string }) => banner.altText,
    ),
  ).toEqual(["AARAJ seasonal collection", "AARAJ second seasonal collection"]);
});

test("catalog operator configures a product through to storefront visibility", async ({
  page,
}) => {
  test.setTimeout(180_000);

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
  const administrationNav = page.getByRole("navigation", {
    name: "Administration",
  });
  await expect(
    administrationNav.getByRole("link", { name: "Size guides" }),
  ).toBeVisible();
  await expect(
    administrationNav.getByRole("link", { name: "Categories" }),
  ).toBeVisible();

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
  await page.getByRole("button", { name: "Create category" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/categories$/);
  await openRowActions(
    page,
    page.getByRole("row").filter({ hasText: "Clothing" }),
  );
  await page.getByRole("menuitem", { name: "Edit category" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Clothing",
  );
  const saveCategory = page.getByRole("button", { name: "Save category" });
  await expect(saveCategory).toBeDisabled();
  await page.getByLabel("Name", { exact: true }).fill("Clothing edited");
  await expect(saveCategory).toBeEnabled();
  await page.getByLabel("Name", { exact: true }).fill("Clothing");
  await expect(saveCategory).toBeDisabled();
  await page.goto("/admin/catalog/categories/create");
  await page.getByLabel("Name", { exact: true }).fill("T-shirts");
  await page.getByLabel("Slug").fill("t-shirts");
  await chooseSelectOption(page, "Parent category", "Clothing");
  await page.getByRole("button", { name: "Create category" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/categories$/);

  await page.goto("/admin/catalog/size-guides/create");
  await expect(
    page.getByRole("heading", { name: "Create size guide", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("Guide name").fill(guideName);
  await chooseSelectOption(page, "Guide category", "Clothing");
  await page.getByLabel("Fit (optional)").fill("Regular");
  await page.getByRole("button", { name: "Add size" }).click();
  await page.getByRole("button", { name: "Add size" }).click();
  await page.locator("#size-label-0").fill("S");
  await page.locator("#size-0-chest_width").fill("20");
  await page.locator("#size-0-body_length").fill("28");
  await page.locator("#size-label-1").fill("M");
  await page.locator("#size-1-chest_width").fill("21");
  await page.locator("#size-1-body_length").fill("29");
  await page.getByRole("button", { name: "Create guide" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/size-guides$/);
  await expect(
    page.getByRole("row", { name: new RegExp(guideName) }),
  ).toBeVisible();
  await openRowActions(
    page,
    page.getByRole("row", { name: new RegExp(guideName) }),
  );
  await page.getByRole("menuitem", { name: "Edit size guide" }).click();
  const saveGuide = page.getByRole("button", { name: "Save guide" });
  await expect(saveGuide).toBeDisabled();
  await page.getByLabel("Guide name").fill(`${guideName} edited`);
  await expect(saveGuide).toBeEnabled();
  await page.getByLabel("Guide name").fill(guideName);
  await expect(saveGuide).toBeDisabled();

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
  await variantField(page, 1, "SKU").fill(skuSmall);
  await variantField(page, 1, "Color").fill("Black");
  await variantField(page, 1, "Size").fill("S");
  await variantField(page, 1, "Price (BDT)").fill("2450");
  await page.getByRole("button", { name: "Add variant" }).click();
  await variantField(page, 2, "SKU").fill(skuMedium);
  await variantField(page, 2, "Color").fill("Red");
  await variantField(page, 2, "Size").fill("M");
  await variantField(page, 2, "Price (BDT)").fill("2490");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);

  expect(
    (await page.request.get(`/api/v1/catalog/products/${slug}`)).status(),
  ).toBe(404);
  expect((await page.goto(`/shop/products/${slug}`))?.status()).toBe(404);
  await page.goto("/shop");
  await expect(page.getByRole("link", { name: productName })).toHaveCount(0);

  await page.goto("/admin/catalog");
  await openRowActions(
    page,
    page.getByRole("row").filter({ hasText: productName }),
  );
  await page.getByRole("menuitem", { name: "Edit product" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit product", level: 2 }),
  ).toBeVisible();
  const saveProduct = page.getByRole("button", { name: "Save changes" });
  await expect(saveProduct).toBeDisabled();
  const managedSkuFields = page
    .getByRole("row", { name: /^Variant \d+$/ })
    .getByLabel("SKU", { exact: true });
  await expect(managedSkuFields).toHaveCount(2);
  const managedSkus = await managedSkuFields.evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).value),
  );
  expect(managedSkus).toEqual(expect.arrayContaining([skuSmall, skuMedium]));
  await expect(
    page.getByRole("combobox", { name: "Reusable size guide" }),
  ).toContainText(guideName);
  await page.getByLabel("Published on the storefront").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);

  await page.goto("/shop");
  await expect(
    page.getByRole("button", { name: "Show up to 4 columns" }),
  ).toHaveAttribute("aria-pressed", "true");
  await chooseSelectOption(page, "Product category", "Clothing / T-shirts");
  const productFilters = page.locator('aside[aria-label="Product filters"]');
  await page
    .getByRole("searchbox", { name: "Search products" })
    .fill("100% cotton");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("search") === "100% cotton",
  );
  await productFilters.getByRole("radio", { name: "Unisex" }).check();
  await expect(page).toHaveURL(/audience=unisex/);
  await productFilters.getByRole("checkbox", { name: "Black" }).check();
  await expect(page).toHaveURL(/color=Black/);
  await productFilters.getByRole("checkbox", { name: "S" }).check();
  await expect(page).toHaveURL(/size=S/);
  await expect(page).toHaveURL(/audience=unisex/);
  expect(new URL(page.url()).searchParams.get("search")).toBe("100% cotton");
  await expect(page.getByRole("link", { name: productName })).toBeVisible();
  await expect(page.getByText("From ৳2,450", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", { name: `${productName}: image unavailable` }),
  ).toBeVisible();
  const minimumPrice = productFilters.getByLabel("Minimum (৳)");
  await minimumPrice.fill("2450");
  await expect(page).toHaveURL(/minPriceBdt=2450/);
  await expect(page.getByRole("link", { name: productName })).toBeVisible();

  const minimumPriceSlider = productFilters.getByRole("slider", {
    name: "Minimum price",
  });
  await minimumPriceSlider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(minimumPrice).toHaveValue("2451");
  await expect(page).toHaveURL(/minPriceBdt=2451/);
  await expect(page.getByRole("link", { name: productName })).toHaveCount(0);

  await minimumPrice.fill("2450");
  await expect(page).toHaveURL(/minPriceBdt=2450/);
  await expect(page.getByRole("link", { name: productName })).toBeVisible();

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
  const productSeoResponse = await page.request.get(`/shop/products/${slug}`, {
    headers: { "User-Agent": "facebookexternalhit/1.1" },
  });
  expect(productSeoResponse.status()).toBe(200);
  const storefrontSettings = await page.request
    .get("/api/v1/storefront/settings")
    .then((response) => response.json());
  const productShareImageSrc =
    storefrontSettings.socialImage?.src ??
    storefrontSettings.logo?.src ??
    "/aaraj-social.png";
  const productShareImageAlt = storefrontSettings.socialImage
    ? (storefrontSettings.socialImageAlt ??
      `${storefrontSettings.siteName} storefront`)
    : `${storefrontSettings.siteName} logo`;
  const productHead = (await productSeoResponse.text()).match(
    /<head>([\s\S]*?)<\/head>/,
  )?.[1];
  expect(productHead).toBeTruthy();
  expect(productHead).toContain(
    `<title>${storefrontSettings.siteName} | ${productName}</title>`,
  );
  expect(productHead).toContain(
    `<meta property="og:title" content="${productName}"`,
  );
  expect(productHead).toContain(
    '<meta property="og:description" content="A product configured in a real browser and database flow."',
  );
  expect(productHead).toContain(
    `rel="canonical" href="http://127.0.0.1:3180/shop/products/${slug}"`,
  );
  expect(productHead).toContain(
    `property="og:image" content="http://127.0.0.1:3180${productShareImageSrc}"`,
  );
  expect(productHead).toContain(
    `<meta name="twitter:image:alt" content="${productShareImageAlt}"`,
  );

  const robotsResponse = await page.request.get("/robots.txt");
  expect(robotsResponse.status()).toBe(200);
  const robotsBody = await robotsResponse.text();
  expect(robotsBody).toContain("User-Agent: *");
  expect(robotsBody).toContain("Allow: /");
  expect(robotsBody).toContain("Sitemap: http://127.0.0.1:3180/sitemap.xml");
  expect(robotsBody).not.toContain("Disallow:");

  const sitemapResponse = await page.request.get("/sitemap.xml");
  expect(sitemapResponse.status()).toBe(200);
  const sitemapBody = await sitemapResponse.text();
  expect(sitemapBody).toContain("<loc>http://127.0.0.1:3180/</loc>");
  expect(sitemapBody).toContain(
    `<loc>http://127.0.0.1:3180/shop/products/${slug}</loc>`,
  );
  expect(sitemapBody).not.toContain("/account");
  expect(sitemapBody).not.toContain("/admin");

  await page.goto("/admin/inventory");
  await expect(
    page.getByRole("heading", { name: "Inventory", level: 1 }),
  ).toBeVisible();
  const smallVariantRow = page.getByRole("row").filter({
    hasText: new RegExp(`${productName}.*Black\\s*·\\s*S`),
  });
  await openRowActions(page, smallVariantRow);
  await page.getByRole("menuitem", { name: "Adjust stock" }).click();
  await page.getByLabel("Units").fill("12");
  await page.getByLabel("Reason").fill("Receive integration test stock");
  await page.getByRole("button", { name: "Receive stock" }).click();
  await expect(page).toHaveURL(/\/admin\/inventory$/);
  await expect(smallVariantRow).toContainText("12");
  await page.goto(`/shop/products/${slug}`);
  await expect(page.getByText("৳2,450–৳2,490", { exact: true })).toBeVisible();
  await expect(
    page.getByText("A product configured in a real browser and database flow."),
  ).toBeVisible();
  await expect(page.getByText("100% cotton")).toBeVisible();
  await expect(page.getByText("Machine wash cold")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "S", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "M", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Black", exact: true }).click();
  await page.getByRole("button", { name: "S", exact: true }).click();
  await expect(page.getByText("৳2,450", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/color=Black/);
  await expect(page).toHaveURL(/size=S/);
  await expect(
    page.locator('header form[action="/shop"] input[name="color"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('header form[action="/shop"] input[name="size"]'),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Size guide" })).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Use centimeters" }),
  ).toHaveCount(0);
  await expect(page.getByText("Chest width (in)")).toBeVisible();
  await expect(page.getByText("20", { exact: true })).toBeVisible();
  await expect(page.getByText("28", { exact: true })).toBeVisible();
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
  await page.goto(`/shop/products/${slug}`);
  await page.getByRole("button", { name: "Black", exact: true }).click();
  await page.getByRole("button", { name: "S", exact: true }).click();
  await page.getByRole("button", { name: "Clear cart" }).click();
  await expect(
    page.getByRole("status").filter({
      hasText: "Your unreadable saved cart was cleared. Add this item again.",
    }),
  ).toBeVisible();
  expect(cartReadIsCorrupt).toBe(false);
  await page.unroute("**/api/v1/cart");
  await page.getByRole("button", { name: "Add to cart" }).click();
  const cartSheet = page.getByRole("dialog", { name: "Your cart" });
  await expect(cartSheet).toBeVisible();
  await expect(
    cartSheet.getByRole("link", { name: productName }),
  ).toBeVisible();
  await cartSheet.getByRole("link", { name: "Checkout" }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(cartSheet).not.toBeVisible();
  await expect(
    page.getByRole("main").getByRole("heading", { name: "Checkout" }),
  ).toBeVisible();
  const checkoutSummary = page.getByRole("complementary", {
    name: "Order summary",
  });
  await expect(
    checkoutSummary.getByRole("button", {
      name: `Remove ${productName}, Black, S`,
    }),
  ).toBeVisible();
  await expect(
    checkoutSummary.getByRole("button", {
      name: `Increase quantity for ${productName}, Black, S`,
    }),
  ).toBeVisible();
  await page.goto("/cart");
  await expect(page).toHaveURL(/\/cart$/);

  await expect(
    page.getByRole("main").getByRole("heading", { name: "Your cart" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: productName })).toBeVisible();

  const quoteSection = page.getByRole("region", { name: "Delivery and quote" });
  await chooseSelectOption(page, "Division", "ঢাকা বিভাগ");
  await chooseSelectOption(page, "District", "ঢাকা জেলা");
  const quoteRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/api/v1/quotes"),
  );
  await quoteSection
    .getByRole("button", { name: "Get delivery quote" })
    .click();
  const quoteRequest = await quoteRequestPromise;
  expect(Object.keys(quoteRequest.postDataJSON()).sort()).toEqual([
    "districtId",
    "divisionId",
    "geographyVersion",
  ]);
  await expect(
    quoteSection.getByRole("heading", { name: "Delivery quote" }),
  ).toBeVisible();
  await expect(
    quoteSection.getByText("Delivery", { exact: true }),
  ).toBeVisible();
  await expect(quoteSection.getByText("৳80", { exact: true })).toBeVisible();

  await chooseSelectOption(page, "Division", "চট্টগ্রাম বিভাগ");
  await chooseSelectOption(page, "District", "চট্টগ্রাম জেলা");
  await expect(
    quoteSection.getByRole("heading", { name: "Delivery quote" }),
  ).toHaveCount(0);
  await expect(
    quoteSection.getByRole("button", { name: "Get delivery quote" }),
  ).toBeVisible();
  await chooseSelectOption(page, "Division", "ঢাকা বিভাগ");
  await chooseSelectOption(page, "District", "ঢাকা জেলা");
  await quoteSection
    .getByRole("button", { name: "Get delivery quote" })
    .click();
  await expect(
    quoteSection.getByRole("heading", { name: "Delivery quote" }),
  ).toBeVisible();

  const quantitySelect = page.getByRole("combobox", {
    name: `Quantity for ${productName}, Black, S`,
  });
  await chooseSelectOption(page, `Quantity for ${productName}, Black, S`, "2");
  await expect(quantitySelect).toHaveText("2");
  await expect(
    quoteSection
      .getByRole("status")
      .filter({ hasText: "This quote is no longer current." }),
  ).toBeVisible();
  await quoteSection
    .getByRole("button", { name: "Request updated quote" })
    .click();
  await expect(
    quoteSection.getByRole("heading", { name: "Delivery quote" }),
  ).toBeVisible();
  await expect(quoteSection.getByText("৳80", { exact: true })).toBeVisible();
  await page.reload();
  await expect(quantitySelect).toHaveText("2");
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Your cart is empty.")).toBeVisible();

  await page.goto(`/shop/products/${slug}`);
  await page.getByRole("button", { name: "Black", exact: true }).click();
  await page.getByRole("button", { name: "S", exact: true }).click();
  await page.getByRole("button", { name: "Buy Now" }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(
    page.getByRole("heading", { name: "Delivery location" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Order summary" }),
  ).toBeVisible();
  await expect(page.getByText(productName, { exact: true })).toBeVisible();
  const directCheckoutSummary = page.getByRole("complementary", {
    name: "Order summary",
  });
  const directQuoteResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/v1/quotes"),
  );
  await chooseSelectOption(page, "Division", "ঢাকা বিভাগ");
  await chooseSelectOption(page, "District", "ঢাকা জেলা");
  const directQuoteResponse = await directQuoteResponsePromise;
  expect(directQuoteResponse.status()).toBe(201);
  const directQuote = await directQuoteResponse.json();
  await expect(
    directCheckoutSummary.getByRole("button", { name: "Place COD order" }),
  ).toBeVisible();
  await expect(page.getByLabel("Full name")).toBeVisible();
  await expect(
    directCheckoutSummary.getByText(
      `৳${Number(directQuote.totalBdt).toLocaleString("en-BD")}`,
      { exact: true },
    ),
  ).toBeVisible();
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
  await chooseSelectOption(page, "Division", "ঢাকা বিভাগ");
  await chooseSelectOption(page, "District", "ঢাকা জেলা");
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
  await expect(quantitySelect).toHaveText("1");

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

  await chooseSelectOption(page, "Division", "ঢাকা বিভাগ");
  await chooseSelectOption(page, "District", "ঢাকা জেলা");
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
    quoteSection.getByRole("heading", { name: "Delivery quote" }),
  ).toBeVisible();
  await expect(quoteSection.getByText("৳80", { exact: true })).toBeVisible();

  await quoteSection
    .getByRole("link", { name: "Continue to checkout" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Checkout", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("Full name").fill("Integration Customer");
  await page.getByLabel("Mobile number").fill("01712345678");
  await page
    .getByLabel("Delivery address")
    .fill("House 12, Road 5, beside the park");

  const checkoutUrl = page.url();
  let checkoutRequestAborted = false;
  await page.route("**/api/v1/orders", async (route) => {
    if (route.request().method() !== "POST" || checkoutRequestAborted) {
      await route.continue();
      return;
    }
    checkoutRequestAborted = true;
    await route.abort("connectionreset");
  });
  await page.getByRole("button", { name: "Place COD order" }).click();
  await expect.poll(() => checkoutRequestAborted).toBe(true);
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  expect(checkoutRequestAborted).toBe(true);
  await page.unroute("**/api/v1/orders");

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Checkout", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("Full name").fill("Integration Customer");
  await page.getByLabel("Mobile number").fill("01712345678");
  await page
    .getByLabel("Delivery address")
    .fill("House 12, Road 5, beside the park");
  await page.getByRole("button", { name: "Place COD order" }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/i);
  await expect(page.getByTestId("order-reference")).toBeVisible();
  const customerOrderStatus = page.getByRole("status").filter({
    hasText:
      "We’ll contact you to confirm your order and delivery details before dispatch.",
  });
  await expect(customerOrderStatus).toBeVisible();
  await expect(
    page.getByText("Cash on Delivery", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Uncollected; no payment was taken at checkout"),
  ).toBeVisible();
  await expect(page.getByText("Integration Customer")).toBeVisible();
  const customerOrderId = new URL(page.url()).pathname.split("/").at(-1)!;
  const storageAfterCheckout = await page.evaluate(() =>
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
  expect(storageAfterCheckout).not.toContain("Integration Customer");
  expect(storageAfterCheckout).not.toContain("01712345678");

  const orderReference = await page.getByTestId("order-reference").innerText();
  await page.goto(checkoutUrl);
  await expect(page).toHaveURL(`/orders/${customerOrderId}`);
  await expect(page.getByTestId("order-reference")).toHaveText(orderReference);
  const managementListResponse = await page.request.get(
    "/api/v1/orders/manage?limit=50&offset=0",
  );
  expect(managementListResponse.status()).toBe(200);
  const managementList = await managementListResponse.json();
  expect(
    managementList.rows.filter(
      (row: { reference: string }) => row.reference === orderReference,
    ),
  ).toHaveLength(1);

  await page.goto("/admin/orders");
  await expect(
    page.getByRole("heading", { name: "Orders", level: 1 }),
  ).toBeVisible();
  const customerOrderRow = page.getByRole("row").filter({
    has: page.getByRole("button", { name: orderReference, exact: true }),
  });
  await expect(customerOrderRow).toContainText("Pending");
  const managedOrderResponse = await page.request.get(
    `/api/v1/orders/manage/${customerOrderId}`,
  );
  expect(managedOrderResponse.status()).toBe(200);
  await page.goto(`/admin/orders/${customerOrderId}`);
  await expect(
    page.getByRole("heading", { name: "Customer confirmation" }),
  ).toBeVisible();
  await expect(page.getByText("Integration Customer")).toBeVisible();
  await page.getByRole("button", { name: "Confirm order" }).click();
  await expect(
    page.getByText("Confirmed · Serviceable", { exact: true }),
  ).toBeVisible();

  const pathaoPanel = page.getByRole("region", {
    name: "Pathao courier booking",
  });
  await expect(pathaoPanel).toBeVisible();
  await expect(pathaoPanel.getByLabel("Pathao delivery type")).toHaveCount(0);
  await expect(pathaoPanel).toContainText("1 item");
  await expect(pathaoPanel).toContainText("0.5 kg minimum");
  await expect(pathaoPanel.getByLabel("Actual parcel count")).toHaveCount(0);
  await expect(pathaoPanel.getByLabel("Actual parcel weight (kg)")).toHaveCount(
    0,
  );
  await expect(
    pathaoPanel.getByRole("button", { name: "Book order in Pathao" }),
  ).toBeVisible();
  await expect(
    page.getByText("Cancel order and release reserved stock", { exact: true }),
  ).toBeVisible();

  const bookingRequests: Array<{
    commandId: string;
    hasBody: boolean;
  }> = [];
  const bookingPath =
    `**/api/v1/delivery/pathao/manage/orders/${customerOrderId}/book` as const;
  await page.route(bookingPath, async (route) => {
    if (route.request().method() === "POST") {
      bookingRequests.push({
        commandId: route.request().headers()["idempotency-key"] ?? "",
        hasBody: route.request().postData() !== null,
      });
    }
    await route.continue();
  });
  await pathaoPanel
    .getByRole("button", { name: "Book order in Pathao" })
    .click();
  await expect(pathaoPanel).toContainText("Booked");
  await expect(pathaoPanel).toContainText("PATHAO-BROWSER-E2E-01");
  expect(bookingRequests).toHaveLength(1);
  expect(bookingRequests[0]?.hasBody).toBe(false);
  expect(bookingRequests[0]?.commandId).toBeTruthy();
  await expect(
    pathaoPanel.getByRole("button", { name: "Record Pathao pickup" }),
  ).toBeVisible();
  await page.unroute(bookingPath);

  const dispatchCommandIds: string[] = [];
  let firstDispatchCommitted = false;
  const dispatchPath =
    `**/api/v1/orders/manage/${customerOrderId}/dispatch` as const;
  await page.route(dispatchPath, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    dispatchCommandIds.push(route.request().headers()["idempotency-key"] ?? "");
    if (!firstDispatchCommitted) {
      firstDispatchCommitted = true;
      const committedResponse = await route.fetch();
      expect(committedResponse.status()).toBe(201);
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await pathaoPanel
    .getByRole("button", { name: "Record Pathao pickup" })
    .click();
  await expect(pathaoPanel.getByRole("alert")).toContainText("dispatch", {
    ignoreCase: true,
  });
  await pathaoPanel
    .getByRole("button", { name: "Record Pathao pickup" })
    .click();
  await expect(
    page.getByText("Dispatched · COD Uncollected", { exact: true }),
  ).toBeVisible();
  expect(dispatchCommandIds).toHaveLength(2);
  expect(dispatchCommandIds[0]).toBeTruthy();
  expect(dispatchCommandIds[1]).toBe(dispatchCommandIds[0]);
  await page.unroute(dispatchPath);

  await page.goto(`/orders/${customerOrderId}`);
  await expect(
    page.getByRole("region", { name: "Dispatch details" }),
  ).toContainText("Pathao Courier");
  await expect(
    page.getByRole("region", { name: "Dispatch details" }),
  ).toContainText("PATHAO-BROWSER-E2E-01");
  await expect(
    page.getByText("Uncollected; no payment was taken at checkout", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Total due on delivery", { exact: true }),
  ).toBeVisible();
  const pathaoTracking = page.getByRole("region", {
    name: "Courier tracking",
  });
  await expect(pathaoTracking).toContainText("PATHAO-BROWSER-E2E-01");
  await expect(page.getByRole("status")).toContainText(
    "Handed to Pathao Courier on",
  );

  await page.goto(`/admin/orders/${customerOrderId}`);
  await expect(
    page.getByRole("heading", { name: "Record delivery outcome" }),
  ).toBeVisible();
  await page
    .getByLabel("Verification note")
    .fill("Verified signed delivery receipt");
  await page.getByRole("button", { name: "Record Delivered" }).click();
  await expect(
    page.getByRole("heading", { name: "Reconcile COD collection" }),
  ).toBeVisible();

  const deliveredOrderResponse = await page.request.get(
    `/api/v1/orders/manage/${customerOrderId}`,
  );
  expect(deliveredOrderResponse.status()).toBe(200);
  const codAmountDueBdt = (await deliveredOrderResponse.json()).codAmountDueBdt;
  await page.getByLabel("Amount collected (BDT)").fill(String(codAmountDueBdt));
  await page
    .getByLabel("Verification note")
    .fill("Matched signed courier receipt");
  await page.getByRole("button", { name: "Save COD reconciliation" }).click();
  await expect(
    page.getByRole("status").filter({
      hasText: `Collected: ${codAmountDueBdt} / ${codAmountDueBdt} BDT`,
    }),
  ).toBeVisible();

  await page.goto(`/orders/${customerOrderId}`);
  await expect(
    page.getByRole("status").filter({ hasText: "recorded as delivered" }),
  ).toBeVisible();
  await expect(page.getByText("COD collected", { exact: true })).toBeVisible();

  await page.goto("/admin");
  await page.locator("summary[aria-label^='Account menu for']").click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.goto(`/shop/products/${slug}`);
  await page.getByRole("button", { name: "Black", exact: true }).click();
  await page.getByRole("button", { name: "S", exact: true }).click();
  await page.getByRole("button", { name: "Add to cart" }).click();
  const guestCartSheet = page.getByRole("dialog", { name: "Your cart" });
  await expect(guestCartSheet).toBeVisible();
  await expect(
    guestCartSheet.getByRole("link", { name: productName }),
  ).toBeVisible();
  await page.goto("/cart");
  const guestQuoteSection = page.getByRole("region", {
    name: "Delivery and quote",
  });
  await chooseSelectOption(page, "Division", "ঢাকা বিভাগ");
  await chooseSelectOption(page, "District", "ঢাকা জেলা");
  await guestQuoteSection
    .getByRole("button", { name: "Get delivery quote" })
    .click();
  await expect(
    guestQuoteSection.getByRole("heading", { name: "Delivery quote" }),
  ).toBeVisible();
  await guestQuoteSection
    .getByRole("link", { name: "Continue to checkout" })
    .click();
  await page.getByLabel("Full name").fill("Guest Integration Customer");
  await page.getByLabel("Mobile number").fill("01712345679");
  await page
    .getByLabel("Delivery address")
    .fill("House 8, Road 3, near the market");
  await page.getByRole("button", { name: "Place COD order" }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/i);
  const guestOrderUrl = page.url();
  expect(guestOrderUrl).not.toMatch(/token|credential|access/i);
  await expect(page.getByTestId("order-reference")).toBeVisible();
  await expect(
    page.getByText("Guest tracking is available in this browser until"),
  ).toBeVisible();
  const guestOrderId = new URL(guestOrderUrl).pathname.split("/").at(-1)!;
  const guestOrderCookie = (await page.context().cookies()).find(
    ({ name }) => name === `aaraj_order_${guestOrderId}`,
  );
  expect(guestOrderCookie).toMatchObject({
    httpOnly: true,
    sameSite: "Lax",
    path: `/api/v1/orders/${guestOrderId}`,
  });
  expect(
    (await page.context().cookies()).some(({ name }) =>
      name.startsWith("aaraj_order_attempt_"),
    ),
  ).toBe(false);
  const guestBrowserStorage = await page.evaluate(() =>
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
  expect(guestBrowserStorage).not.toContain("Guest Integration Customer");
  expect(guestBrowserStorage).not.toContain("01712345679");
  await page.reload();
  await expect(page.getByTestId("order-reference")).toBeVisible();

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

  const publicResponse = await page.request.get(
    `/api/v1/catalog/products/${slug}`,
  );
  expect(publicResponse.status()).toBe(200);
  const publicProduct = await publicResponse.json();
  expect(publicProduct.variants).toHaveLength(2);
  expect(publicProduct.price).toEqual({ amountBdt: 2450 });
  expect(publicProduct.variants).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        color: "Black",
        sizeLabel: "S",
        price: { amountBdt: 2450 },
      }),
      expect.objectContaining({
        color: "Red",
        sizeLabel: "M",
        price: { amountBdt: 2490 },
      }),
    ]),
  );
  for (const variant of publicProduct.variants) {
    expect(variant).not.toHaveProperty("sku");
  }

  await page.goto("/admin/catalog");
  await openRowActions(
    page,
    page.getByRole("row").filter({ hasText: productName }),
  );
  await page.getByRole("menuitem", { name: "Edit product" }).click();
  await page.getByLabel("Published on the storefront").uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);

  expect(
    (await page.request.get(`/api/v1/catalog/products/${slug}`)).status(),
  ).toBe(404);
  expect((await page.goto(`/shop/products/${slug}`))?.status()).toBe(404);
  await page.goto("/");
  await expect(page.getByRole("link", { name: productName })).toHaveCount(0);
});
