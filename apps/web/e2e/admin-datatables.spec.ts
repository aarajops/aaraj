import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { chooseSelectOption } from "./select";

const routes = [
  {
    path: "/admin/catalog",
    label: "Products",
    rightAlignedHeader: "Price",
  },
  {
    path: "/admin/catalog/categories",
    label: "Product categories",
    rightAlignedHeader: "Order",
  },
  {
    path: "/admin/catalog/size-guides",
    label: "Size guides",
  },
  {
    path: "/admin/inventory",
    label: "Inventory by product variant",
    rightAlignedHeader: "On hand",
  },
  {
    path: "/admin/orders",
    label: "Orders",
    rightAlignedHeader: "COD due",
  },
] as const;

const viewportWidths = [1440, 1280, 1024, 768, 390];

async function measureRenderedTextContrast(locator: Locator) {
  return locator.evaluate((element) => {
    type Rgba = [number, number, number, number];

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;

    function toRgba(cssColor: string): Rgba {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = cssColor;
      context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]! / 255];
    }

    function composite(source: Rgba, destination: Rgba): Rgba {
      const alpha = source[3] + destination[3] * (1 - source[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (source[0] * source[3] +
          destination[0] * destination[3] * (1 - source[3])) /
          alpha,
        (source[1] * source[3] +
          destination[1] * destination[3] * (1 - source[3])) /
          alpha,
        (source[2] * source[3] +
          destination[2] * destination[3] * (1 - source[3])) /
          alpha,
        alpha,
      ];
    }

    function luminance(color: Rgba): number {
      const channels = color.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return (
        0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
      );
    }

    const ancestors: HTMLElement[] = [];
    for (
      let current: HTMLElement | null = element as HTMLElement;
      current;
      current = current.parentElement
    ) {
      ancestors.push(current);
    }

    let background: Rgba = [255, 255, 255, 1];
    for (const ancestor of ancestors.reverse()) {
      const style = getComputedStyle(ancestor);
      const color = toRgba(style.backgroundColor);
      color[3] *= Number(style.opacity || "1");
      background = composite(color, background);
    }

    const foreground = toRgba(getComputedStyle(element).color);
    const opacity = ancestors.reduce(
      (value, ancestor) =>
        value * Number(getComputedStyle(ancestor).opacity || "1"),
      1,
    );
    foreground[3] *= opacity;
    const renderedForeground = composite(foreground, background);
    const foregroundLuminance = luminance(renderedForeground);
    const backgroundLuminance = luminance(background);
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);

    return {
      foreground: renderedForeground.slice(0, 3).map(Math.round),
      background: background.slice(0, 3).map(Math.round),
      ratio: (lighter + 0.05) / (darker + 0.05),
    };
  });
}

async function inspectKeyboardFocus(page: Page, locator: Locator) {
  await locator.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(locator).toBeFocused();
  await page.waitForTimeout(200);

  return locator.evaluate((target) => {
    type Rgba = [number, number, number, number];
    const surface = target.matches('[data-slot="input-group-control"]')
      ? (target.closest<HTMLElement>('[data-slot="input-group"]') ?? target)
      : target;
    const style = getComputedStyle(surface);
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;

    function toRgba(cssColor: string): Rgba {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = cssColor;
      context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]! / 255];
    }

    function composite(source: Rgba, destination: Rgba): Rgba {
      const alpha = source[3] + destination[3] * (1 - source[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (source[0] * source[3] +
          destination[0] * destination[3] * (1 - source[3])) /
          alpha,
        (source[1] * source[3] +
          destination[1] * destination[3] * (1 - source[3])) /
          alpha,
        (source[2] * source[3] +
          destination[2] * destination[3] * (1 - source[3])) /
          alpha,
        alpha,
      ];
    }

    function luminance(color: Rgba): number {
      const channels = color.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return (
        0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
      );
    }

    function contrast(left: Rgba, right: Rgba): number {
      const first = luminance(left);
      const second = luminance(right);
      const lighter = Math.max(first, second);
      const darker = Math.min(first, second);
      return (lighter + 0.05) / (darker + 0.05);
    }

    const ancestors: HTMLElement[] = [];
    for (
      let current: HTMLElement | null = surface.parentElement;
      current;
      current = current.parentElement
    ) {
      ancestors.push(current);
    }
    let backdrop: Rgba = [255, 255, 255, 1];
    for (const ancestor of ancestors.reverse()) {
      const background = toRgba(getComputedStyle(ancestor).backgroundColor);
      backdrop = composite(background, backdrop);
    }

    const shadowColors = Array.from(
      style.boxShadow.matchAll(/(?:rgba?|oklab|oklch|lab|color)\([^)]*\)/g),
      ([color]) => color,
    );
    const shadowColor = shadowColors.find((color) => toRgba(color)[3] > 0);
    const shadow = shadowColor ? toRgba(shadowColor) : null;
    const ringOnBackdrop = shadow
      ? composite(shadow, backdrop)
      : ([0, 0, 0, 0] as Rgba);
    const outline = toRgba(style.outlineColor);
    const hasVisibleOutline =
      style.outlineStyle !== "none" &&
      Number.parseFloat(style.outlineWidth) > 0 &&
      outline[3] > 0;
    const border = toRgba(style.borderTopColor);
    const rect = target.getBoundingClientRect();
    const x = Math.min(Math.max(rect.left + 1, 0), window.innerWidth - 1);
    const y = Math.min(Math.max(rect.top + 1, 0), window.innerHeight - 1);
    const hit = document.elementFromPoint(x, y);

    return {
      focusVisible: target.matches(":focus-visible"),
      boxShadow: style.boxShadow,
      borderColor: style.borderTopColor,
      outlineColor: style.outlineColor,
      borderContrast: contrast(border, backdrop),
      ringContrast: shadow ? contrast(ringOnBackdrop, backdrop) : null,
      outlineContrast: hasVisibleOutline ? contrast(outline, backdrop) : null,
      targetInViewport:
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth,
      notObscured: Boolean(
        hit && (hit === target || target.contains(hit) || hit.contains(target)),
      ),
    };
  });
}

async function signInAsAdmin(
  context: BrowserContext,
  baseURL: string | undefined,
) {
  await context.addCookies([
    {
      name: "aaraj-e2e-role",
      value: "admin",
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  const path = testInfo.outputPath(name);
  await page.screenshot({ path, fullPage: false });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown) {
  const path = testInfo.outputPath(name);
  await writeFile(path, JSON.stringify(value, null, 2));
  await testInfo.attach(name, { path, contentType: "application/json" });
}

test("admin data tables keep shared geometry and responsive scroll behavior", async ({
  page,
  context,
  baseURL,
}, testInfo: TestInfo) => {
  test.setTimeout(120_000);
  await signInAsAdmin(context, baseURL);
  await page.route("**/api/v1/catalog/products/manage?*", async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        products: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            slug: "aaraj-cotton-tee",
            name: "Aaraj Cotton Tee",
            description: "A deterministic table screenshot fixture.",
            audience: "unisex",
            category: null,
            fit: "Regular",
            fabricComposition: "100% cotton",
            careInstructions: "Machine wash cold.",
            sizeGuideId: null,
            price: { amountBdt: 1800 },
            isPublished: true,
            createdAt: "2026-10-01T12:00:00.000Z",
            updatedAt: "2026-10-01T12:00:00.000Z",
          },
        ],
        hasMore: false,
        nextOffset: null,
      },
    });
  });

  for (const route of routes) {
    for (const width of viewportWidths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route.path);

      const table = page.getByRole("table", { name: route.label });
      await expect(table).toBeVisible();
      if (route.label === "Products") {
        await page.getByRole("button", { name: "Refresh products" }).click();
        await expect(
          table.getByRole("row", { name: /Aaraj Cotton Tee/ }),
        ).toBeVisible();
      }
      await expect(table.locator("thead th").first()).toHaveCSS(
        "font-size",
        "14px",
      );

      const headerHeight = await table
        .locator("thead th")
        .first()
        .evaluate((element) => element.getBoundingClientRect().height);
      expect(headerHeight).toBeGreaterThanOrEqual(48);
      expect(headerHeight).toBeLessThan(52);

      const firstBodyRowHeight = await table
        .locator("tbody tr")
        .first()
        .evaluate((element) => element.getBoundingClientRect().height);
      expect(firstBodyRowHeight).toBeGreaterThanOrEqual(48);
      await expect(table.locator("thead th").last()).toHaveText("Actions");

      if ("rightAlignedHeader" in route) {
        const numericHeader = table.getByRole("columnheader", {
          name: route.rightAlignedHeader,
        });
        await expect(numericHeader).toHaveCSS("text-align", "right");
        const numericColumnIndex = await numericHeader.evaluate((element) =>
          Array.from(element.parentElement?.children ?? []).indexOf(element),
        );
        const firstRowCells = table.locator("tbody tr").first().locator("td");
        if ((await firstRowCells.count()) > 1) {
          await expect(firstRowCells.nth(numericColumnIndex)).toHaveCSS(
            "text-align",
            "right",
          );
        }
      }

      const dimensions = await page.evaluate(() => {
        const region = document.querySelector<HTMLElement>(
          '[data-slot="table-container"]',
        );
        const table = document.querySelector<HTMLTableElement>(
          '[data-slot="table"]',
        );
        return {
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          regionClientWidth: region?.clientWidth ?? 0,
          regionScrollWidth: region?.scrollWidth ?? 0,
          tableWidth: table?.getBoundingClientRect().width ?? 0,
          tableLayout: table ? getComputedStyle(table).tableLayout : "",
        };
      });
      expect(dimensions.documentWidth).toBeLessThanOrEqual(
        dimensions.viewportWidth,
      );
      expect(dimensions.regionClientWidth).toBeLessThanOrEqual(
        dimensions.viewportWidth,
      );
      expect(dimensions.tableWidth).toBeGreaterThanOrEqual(
        dimensions.regionClientWidth - 1,
      );
      expect(dimensions.tableLayout).toBe("auto");
      if (width === 1440) {
        expect(dimensions.tableWidth).toBeLessThanOrEqual(
          dimensions.regionClientWidth + 1,
        );
      }
      if (width <= 768) {
        expect(dimensions.regionScrollWidth).toBeGreaterThan(
          dimensions.regionClientWidth,
        );
      }

      if (width === 390) {
        const rowActions = table.getByRole("link");
        if ((await rowActions.count()) > 0) {
          const rowAction = rowActions.last();
          await rowAction.scrollIntoViewIfNeeded();
          const actionBounds = await rowAction.evaluate((element) => {
            const link = element.getBoundingClientRect();
            const region = element.closest<HTMLElement>(
              "[data-slot='table-container']",
            );
            const regionBounds = region?.getBoundingClientRect();
            return {
              left: link.left,
              right: link.right,
              regionLeft: regionBounds?.left ?? 0,
              regionRight: regionBounds?.right ?? 0,
            };
          });
          expect(actionBounds.left).toBeGreaterThanOrEqual(
            actionBounds.regionLeft - 1,
          );
          expect(actionBounds.right).toBeLessThanOrEqual(
            actionBounds.regionRight + 1,
          );
        }
      }

      const routeSlug = route.label.toLowerCase().replaceAll(" ", "-");
      await attachScreenshot(page, testInfo, `${routeSlug}-${width}.png`);
      if (width === 1440 && route.label === "Orders") {
        await attachScreenshot(page, testInfo, "orders-table-desktop.png");
      }
      if (width === 390 && route.label === "Products") {
        await attachScreenshot(page, testInfo, "products-table-mobile.png");
      }
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/orders");
  const ordersScrollRegion = page.getByRole("region", {
    name: "Scrollable orders table",
  });
  await page.getByRole("button", { name: "Apply orders search" }).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Refresh orders" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(ordersScrollRegion).toBeFocused();
  await ordersScrollRegion.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  expect(
    await ordersScrollRegion.evaluate((element) => element.scrollLeft),
  ).toBeGreaterThan(0);
  await attachScreenshot(page, testInfo, "orders-table-focus-overflow.png");

  const reviewLink = page.getByRole("link", { name: "Review" }).first();
  await page.keyboard.press("Tab");
  await expect(reviewLink).toBeFocused();
  expect(
    await reviewLink.evaluate((element) => element.matches(":focus-visible")),
  ).toBe(true);
  await reviewLink.scrollIntoViewIfNeeded();
  const reviewBounds = await reviewLink.evaluate((element) => {
    const link = element.getBoundingClientRect();
    const region = element.closest<HTMLElement>(
      "[data-slot='table-container']",
    );
    const regionBounds = region?.getBoundingClientRect();
    return {
      left: link.left,
      right: link.right,
      regionLeft: regionBounds?.left ?? 0,
      regionRight: regionBounds?.right ?? 0,
    };
  });
  expect(reviewBounds.left).toBeGreaterThanOrEqual(reviewBounds.regionLeft - 1);
  expect(reviewBounds.right).toBeLessThanOrEqual(reviewBounds.regionRight + 1);
  await attachScreenshot(
    page,
    testInfo,
    "orders-row-action-keyboard-focus.png",
  );
});

test("product refresh alert text meets WCAG AA contrast in both themes", async ({
  page,
  context,
  baseURL,
}, testInfo: TestInfo) => {
  await signInAsAdmin(context, baseURL);
  await page.goto("/admin/catalog");
  await expect(page.getByRole("table", { name: "Products" })).toBeVisible();
  await page.route("**/api/v1/catalog/products/manage?*", async (route) => {
    await route.fulfill({
      status: 503,
      json: {
        statusCode: 503,
        message: "Product refresh is temporarily unavailable.",
      },
    });
  });
  await page.getByRole("button", { name: "Refresh products" }).click();
  const alertText = page.getByRole("alert").locator("p").first();
  await expect(alertText).toContainText(
    "Product refresh is temporarily unavailable.",
  );

  const results: Record<
    string,
    Awaited<ReturnType<typeof measureRenderedTextContrast>>
  > = {};
  for (const theme of ["light", "dark"] as const) {
    await page.locator("html").evaluate((html, nextTheme) => {
      html.classList.toggle("dark", nextTheme === "dark");
    }, theme);
    results[theme] = await measureRenderedTextContrast(alertText);
  }

  await attachJson(testInfo, "product-refresh-alert-contrast.json", results);
  console.log("Product refresh alert contrast:", JSON.stringify(results));
  expect(results.light!.ratio).toBeGreaterThanOrEqual(4.5);
  expect(results.dark!.ratio).toBeGreaterThanOrEqual(4.5);
});

test("admin table controls retain visible keyboard focus in light and dark themes", async ({
  page,
  context,
  baseURL,
}, testInfo: TestInfo) => {
  await signInAsAdmin(context, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/orders");

  const targets = [
    ["search input", page.getByRole("searchbox", { name: "Search orders" })],
    [
      "search button",
      page.getByRole("button", { name: "Apply orders search" }),
    ],
    ["refresh button", page.getByRole("button", { name: "Refresh orders" })],
    ["page size select", page.getByRole("combobox", { name: "Rows per page" })],
    ["pagination link", page.getByRole("link", { name: "Next orders page" })],
    ["row action", page.getByRole("link", { name: "Review" }).first()],
    [
      "table scroll region",
      page.getByRole("region", { name: "Scrollable orders table" }),
    ],
  ] as const;
  type Theme = "light" | "dark";
  const measurements: Record<
    Theme,
    Record<string, Awaited<ReturnType<typeof inspectKeyboardFocus>>>
  > = { light: {}, dark: {} };

  for (const theme of ["light", "dark"] as const) {
    await page.locator("html").evaluate((html, nextTheme) => {
      html.classList.toggle("dark", nextTheme === "dark");
    }, theme);

    for (const [name, locator] of targets) {
      const measurement = await inspectKeyboardFocus(page, locator);
      measurements[theme][name] = measurement;
      expect(measurement.focusVisible, `${theme}: ${name}`).toBe(true);
      expect(
        measurement.targetInViewport,
        `${theme}: ${name} remains in the viewport`,
      ).toBe(true);
      expect(measurement.notObscured, `${theme}: ${name} is not obscured`).toBe(
        true,
      );
    }

    if (theme === "dark") {
      await attachScreenshot(
        page,
        testInfo,
        "orders-table-dark-keyboard-focus.png",
      );
    }
  }

  await attachJson(
    testInfo,
    "admin-table-keyboard-focus-measurements.json",
    measurements,
  );
  console.log(
    "Admin table focus contrast:",
    JSON.stringify(
      Object.fromEntries(
        Object.entries(measurements).map(([theme, controls]) => [
          theme,
          Object.fromEntries(
            Object.entries(controls).map(([name, result]) => [
              name,
              {
                ringContrast: result.ringContrast,
                outlineContrast: result.outlineContrast,
                borderContrast: result.borderContrast,
                focusVisible: result.focusVisible,
                notObscured: result.notObscured,
              },
            ]),
          ),
        ]),
      ),
    ),
  );

  for (const theme of ["light", "dark"] as const) {
    for (const [name] of targets) {
      const measurement = measurements[theme][name];
      if (!measurement) {
        throw new Error(`Missing ${theme} focus measurement for ${name}.`);
      }
      expect(
        Math.max(
          measurement.ringContrast ?? 0,
          measurement.outlineContrast ?? 0,
        ),
        `${theme}: ${name} visible focus indicator contrast`,
      ).toBeGreaterThanOrEqual(3);
    }
  }
});

test("category filters and pagination keep URL state and browser history", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL);
  await page.goto("/admin/catalog/categories");

  const table = page.getByRole("table", { name: "Product categories" });
  await chooseSelectOption(page, "Category type", "Parent");
  await expect(page).toHaveURL(/kind=parent/);
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.getByRole("row", { name: /Clothing/ })).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/categories$/);

  await page.goto("/admin/catalog/categories?limit=1");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("link", { name: "Next categories page" }).click();
  await expect(page).toHaveURL(/limit=1&offset=1$/);
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await page.goBack();
  await expect(page).toHaveURL(/limit=1$/);
  await page.goForward();
  await expect(page).toHaveURL(/limit=1&offset=1$/);
});
