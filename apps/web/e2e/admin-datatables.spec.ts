import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { DEFAULT_LIST_PAGE_SIZE } from "@aaraj/contracts";
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
    lastHeader: "COD due",
  },
  {
    path: "/admin/users",
    label: "Users",
    viewports: [1440, 390],
  },
  {
    path: "/admin/storefront/banners",
    label: "Storefront banners",
    viewports: [1440, 390],
  },
  {
    path: "/admin/orders/reconciliation",
    label: "Webhook exceptions",
    viewports: [1440, 390],
    emptyRowActions: true,
  },
] as const;

const viewportWidths = [1440, 1280, 1024, 768, 390];

const loadingTableRoutes = [
  {
    path: "/admin/catalog",
    apiPath: "/api/v1/catalog/products/manage",
    loadingLabel: "products",
    tableLabel: "Products",
  },
  {
    path: "/admin/catalog/categories",
    apiPath: "/api/v1/catalog/categories/manage/page",
    loadingLabel: "categories",
    tableLabel: "Product categories",
  },
  {
    path: "/admin/catalog/size-guides",
    apiPath: "/api/v1/catalog/size-guides/manage",
    loadingLabel: "size guides",
    tableLabel: "Size guides",
  },
  {
    path: "/admin/inventory",
    apiPath: "/api/v1/inventory/manage",
    loadingLabel: "inventory",
    tableLabel: "Inventory by product variant",
  },
  {
    path: "/admin/orders",
    apiPath: "/api/v1/orders/manage",
    loadingLabel: "orders",
    tableLabel: "Orders",
  },
  {
    path: "/admin/users",
    apiPath: "/api/v1/access/users",
    loadingLabel: "users",
    tableLabel: "Users",
  },
  {
    path: "/admin/storefront/banners",
    apiPath: "/api/v1/storefront/manage/banners",
    loadingLabel: "storefront banners",
    tableLabel: "Storefront banners",
  },
  {
    path: "/admin/orders/reconciliation",
    apiPath: "/api/v1/delivery/pathao/manage/issues",
    loadingLabel: "delivery issues",
    tableLabel: "Webhook exceptions",
  },
] as const;

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

async function setMockApiResponseGate(
  page: Page,
  baseURL: string | undefined,
  action: "hold" | "release",
  path: string,
) {
  const apiURL = new URL(baseURL!);
  apiURL.port = String(Number(apiURL.port) + 1);
  apiURL.pathname = "/__e2e/response-gate";
  apiURL.search = "";
  const response = await page.request.post(apiURL.toString(), {
    data: { action, path },
  });
  expect(response.ok(), `mock API ${action} ${path}`).toBe(true);
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
        limit: DEFAULT_LIST_PAGE_SIZE,
        offset: 0,
        hasMore: false,
        nextOffset: null,
      },
    });
  });

  const routeAlignmentByWidth = new Map<
    number,
    Array<{ route: string; titleLeft: number; tableLeft: number }>
  >();

  for (const route of routes) {
    const widths = "viewports" in route ? route.viewports : viewportWidths;
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route.path);

      const table = page.getByRole("table", { name: route.label });
      await expect(table).toBeVisible();
      const checkboxInputs = table.locator(
        '[data-slot="checkbox"] + input[aria-hidden="true"][type="checkbox"]',
      );
      expect(await checkboxInputs.count()).toBeGreaterThan(0);
      const inputSizes = await checkboxInputs.evaluateAll((inputs) =>
        inputs.map((input) => {
          input.removeAttribute("style");
          const bounds = input.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height };
        }),
      );
      expect(
        inputSizes.every(({ width, height }) => width <= 1 && height <= 1),
        `${route.path} native checkbox inputs must stay visually hidden`,
      ).toBe(true);
      const horizontalAlignment = await page.evaluate(() => {
        const title = document.querySelector<HTMLElement>("main h1");
        const tableRegion = document.querySelector<HTMLElement>(
          '[data-slot="table-container"]',
        );
        return {
          titleLeft: title?.getBoundingClientRect().left ?? null,
          tableLeft: tableRegion?.getBoundingClientRect().left ?? null,
        };
      });
      expect(
        horizontalAlignment.titleLeft,
        `${route.path} title should align with the table at ${width}px`,
      ).not.toBeNull();
      expect(
        horizontalAlignment.tableLeft,
        `${route.path} table should render at ${width}px`,
      ).not.toBeNull();
      expect(
        Math.abs(
          horizontalAlignment.titleLeft! - horizontalAlignment.tableLeft!,
        ),
        `${route.path} title and table left edges should align at ${width}px`,
      ).toBeLessThanOrEqual(2);
      const routeAlignment = routeAlignmentByWidth.get(width) ?? [];
      routeAlignment.push({
        route: route.path,
        titleLeft: horizontalAlignment.titleLeft!,
        tableLeft: horizontalAlignment.tableLeft!,
      });
      routeAlignmentByWidth.set(width, routeAlignment);
      await expect(
        table.getByRole("checkbox", {
          name: `Select all ${route.label.toLowerCase()} on this page`,
        }),
      ).toBeVisible();
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
      await expect(
        table.getByRole("columnheader", { name: "Actions" }),
      ).toBeVisible();
      if ("emptyRowActions" in route) {
        await expect(
          table.getByRole("button", {
            name: "Actions for webhook exceptions row 1",
          }),
        ).toHaveCount(0);
      }
      if ("lastHeader" in route) {
        await expect(table.locator("thead th").last()).toHaveText(
          route.lastHeader,
        );
      }

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
      const isHorizontallyScrollable =
        dimensions.regionScrollWidth > dimensions.regionClientWidth + 1;
      if (width === 1440 && route.label === "Orders") {
        expect(isHorizontallyScrollable).toBe(true);
      }
      if (width === 1440 && route.label !== "Orders") {
        expect(dimensions.tableWidth).toBeLessThanOrEqual(
          dimensions.regionClientWidth + 1,
        );
      }
      if (width <= 768) {
        if (route.label !== "Product categories") {
          expect(isHorizontallyScrollable).toBe(true);
        }
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
      if (width === 1440 || width === 390) {
        await attachScreenshot(page, testInfo, `${routeSlug}-${width}.png`);
      }
      if (width === 1440 && route.label === "Orders") {
        await attachScreenshot(page, testInfo, "orders-table-desktop.png");
      }
      if (width === 390 && route.label === "Products") {
        await attachScreenshot(page, testInfo, "products-table-mobile.png");
      }
    }
  }

  for (const [width, alignments] of routeAlignmentByWidth) {
    const titleLefts = alignments.map(({ titleLeft }) => titleLeft);
    const tableLefts = alignments.map(({ tableLeft }) => tableLeft);
    expect(
      Math.max(...titleLefts) - Math.min(...titleLefts),
      `all route titles should share a left edge at ${width}px: ${alignments.map(({ route, titleLeft }) => `${route}=${titleLeft}`).join(", ")}`,
    ).toBeLessThanOrEqual(2);
    expect(
      Math.max(...tableLefts) - Math.min(...tableLefts),
      `all route tables should share a left edge at ${width}px: ${alignments.map(({ route, tableLeft }) => `${route}=${tableLeft}`).join(", ")}`,
    ).toBeLessThanOrEqual(2);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/orders");
  const ordersTable = page.getByRole("table", { name: "Orders" });
  const selectAllOrders = ordersTable.getByRole("checkbox", {
    name: "Select all orders on this page",
  });
  const firstOrderCheckbox = ordersTable.getByRole("checkbox", {
    name: "Select row 1 from orders",
  });
  const firstOrderRow = ordersTable.locator("tbody tr").first();
  await firstOrderCheckbox.click();
  await expect(firstOrderCheckbox).toHaveAttribute("aria-checked", "true");
  await expect(firstOrderRow).toHaveAttribute("data-state", "selected");
  await expect(selectAllOrders).toHaveAttribute("aria-checked", "mixed");
  await expect(page.getByText("1 row selected")).toBeVisible();
  await selectAllOrders.click();
  await expect(selectAllOrders).toHaveAttribute("aria-checked", "true");
  await selectAllOrders.click();
  await expect(selectAllOrders).toHaveAttribute("aria-checked", "false");

  await page.getByRole("button", { name: "Apply orders search" }).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("combobox", { name: "Fulfillment" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Refresh orders" }),
  ).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(selectAllOrders).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(firstOrderCheckbox).toBeFocused();
  const firstRowActions = ordersTable.getByRole("button", {
    name: "Actions for orders row 1",
    exact: true,
  });
  const orderPreviewButton = page.getByRole("button", {
    name: "ORD-026-00001",
    exact: true,
  });
  await page.keyboard.press("Tab");
  await expect(firstRowActions).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(orderPreviewButton).toBeFocused();
  expect(
    await orderPreviewButton.evaluate((element) =>
      element.matches(":focus-visible"),
    ),
  ).toBe(true);
  await orderPreviewButton.scrollIntoViewIfNeeded();
  const orderBounds = await orderPreviewButton.evaluate((element) => {
    const control = element.getBoundingClientRect();
    const region = element.closest<HTMLElement>(
      "[data-slot='table-container']",
    );
    const regionBounds = region?.getBoundingClientRect();
    return {
      left: control.left,
      right: control.right,
      regionLeft: regionBounds?.left ?? 0,
      regionRight: regionBounds?.right ?? 0,
    };
  });
  expect(orderBounds.left).toBeGreaterThanOrEqual(orderBounds.regionLeft - 1);
  expect(orderBounds.right).toBeLessThanOrEqual(orderBounds.regionRight + 1);
  await attachScreenshot(
    page,
    testInfo,
    "orders-order-preview-keyboard-focus.png",
  );
  await page.keyboard.press("Shift+Tab");
  await expect(firstRowActions).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("menuitem", { name: "View order" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menu").getByText("Actions", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Copy order ID ORD-026-00001",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Copy order number" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Print invoice" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
});

test("admin table loading skeletons match each route while data is pending", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await signInAsAdmin(context, baseURL);

  for (const route of loadingTableRoutes) {
    await setMockApiResponseGate(page, baseURL, "hold", route.apiPath);
    let skeletonColumnCount = 0;
    try {
      await page.goto(route.path, { waitUntil: "commit" });
      const skeleton = page.getByRole("status", {
        name: `Loading ${route.loadingLabel}`,
      });
      await expect(skeleton).toBeVisible();
      skeletonColumnCount = await skeleton.locator("table thead th").count();
      expect(skeletonColumnCount).toBeGreaterThan(0);
    } finally {
      await setMockApiResponseGate(page, baseURL, "release", route.apiPath);
    }

    const table = page.getByRole("table", { name: route.tableLabel });
    await expect(table).toBeVisible();
    await expect(table.locator("thead th")).toHaveCount(skeletonColumnCount);
  }
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
      "select all checkbox",
      page.getByRole("checkbox", { name: "Select all orders on this page" }),
    ],
    [
      "row checkbox",
      page.getByRole("checkbox", { name: "Select row 1 from orders" }),
    ],
    [
      "search button",
      page.getByRole("button", { name: "Apply orders search" }),
    ],
    ["refresh button", page.getByRole("button", { name: "Refresh orders" })],
    ["pagination link", page.getByRole("link", { name: "Go to next page" })],
    [
      "order preview button",
      page.getByRole("button", { name: "ORD-026-00001", exact: true }),
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

test("category filters keep URL state and browser history", async ({
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
  await page.goBack();
  await expect(page).toHaveURL(/kind=parent$/);
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await page.goForward();
  await expect(page).toHaveURL(/\/admin\/catalog\/categories$/);
});
