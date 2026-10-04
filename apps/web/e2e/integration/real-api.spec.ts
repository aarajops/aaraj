import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

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

  await page.goto("/account");
  await page.getByRole("button", { name: "Create account" }).first().click();
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
  await expect(page.getByRole("status")).toContainText(
    "Your Aaraj account is ready.",
  );

  await page.reload();
  await expect(page.getByText("Signed in as E2E Customer")).toBeVisible();

  const accessResponse = await page.request.get("/api/access/me");
  expect(accessResponse.status()).toBe(200);
  expect(accessResponse.headers()["cache-control"]).toBe("no-store");
  expect(accessResponse.headers()["x-frame-options"]).toBe("DENY");
  expect(await accessResponse.json()).toMatchObject({
    roles: ["customer"],
  });

  await page.goto("/staff/catalog");
  await expect(
    page.getByRole("heading", { name: "Staff access required" }),
  ).toBeVisible();
});
