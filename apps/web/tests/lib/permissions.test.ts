import { describe, expect, it } from "vitest";
import { can, PERMISSIONS, permsForRole, ROLES } from "../../lib/permissions.js";

describe("permissions matrix", () => {
  it("owner can do everything", () => {
    for (const p of PERMISSIONS) expect(can("owner", p)).toBe(true);
  });

  it("admin cannot delete merchant or change billing", () => {
    expect(can("admin", "merchant:delete")).toBe(false);
    expect(can("admin", "merchant:billing:write")).toBe(false);
    expect(can("admin", "members:invite")).toBe(true);
    expect(can("admin", "products:write")).toBe(true);
  });

  it("finance can read orders and withdraw, cannot edit products", () => {
    expect(can("finance", "orders:read")).toBe(true);
    expect(can("finance", "balance:withdraw")).toBe(true);
    expect(can("finance", "products:write")).toBe(false);
    expect(can("finance", "members:invite")).toBe(false);
  });

  it("support can handle complaints and read orders, cannot withdraw", () => {
    expect(can("support", "complaints:handle")).toBe(true);
    expect(can("support", "orders:read")).toBe(true);
    expect(can("support", "balance:withdraw")).toBe(false);
    expect(can("support", "merchant:delete")).toBe(false);
  });

  it("rejects unknown role", () => {
    // @ts-expect-error testing runtime guard
    expect(can("hacker", "products:read")).toBe(false);
  });

  it("rejects unknown permission", () => {
    // @ts-expect-error testing runtime guard
    expect(can("owner", "nonexistent:perm")).toBe(false);
  });

  it("every role rejects unknown permission", () => {
    for (const role of ROLES) {
      // @ts-expect-error testing runtime guard
      expect(can(role, "fake:perm")).toBe(false);
    }
  });

  it("permsForRole returns all 13 for owner and [] for unknown", () => {
    expect(permsForRole("owner")).toHaveLength(PERMISSIONS.length);
    // @ts-expect-error testing runtime guard
    expect(permsForRole("hacker")).toEqual([]);
  });
});
