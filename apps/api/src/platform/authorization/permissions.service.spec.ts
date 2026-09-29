import { PermissionsService } from "./permissions.service.js";
import type { DatabaseService } from "../database/database.service.js";
import type { Permission } from "@aaraj/contracts";

describe("PermissionsService denial behavior", () => {
  const service = new PermissionsService({} as DatabaseService);

  afterEach(() => vi.restoreAllMocks());

  it("rejects guests and unknown permissions without a database query", async () => {
    const read = vi.spyOn(service, "forUser");
    expect(await service.has(null, "access.manage")).toBe(false);
    expect(await service.has({ id: "owner" }, "*" as Permission)).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it("does not permit a missing identity or silently allow a database failure", async () => {
    const read = vi.spyOn(service, "forUser").mockResolvedValueOnce(null);
    expect(await service.has({ id: "deleted" }, "access.read_self")).toBe(
      false,
    );
    read.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(service.has({ id: "owner" }, "access.manage")).rejects.toThrow(
      "database unavailable",
    );
  });
});
