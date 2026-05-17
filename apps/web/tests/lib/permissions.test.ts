import { describe, expect, it } from "vitest";
import { can, type Permission, type Role } from "../../lib/permissions.js";

const ALL_ROLES: Role[] = ["owner", "admin", "finance", "support"];

describe("permissions matrix", () => {
  it("owner can do everything", () => {
    const allPerms: Permission[] = [
      "merchant:delete",
      "merchant:billing:read",
      "merchant:billing:write",
      "members:invite",
      "members:remove",
      "members:change-role",
      "products:read",
      "products:write",
      "orders:read",
      "orders:refund",
      "balance:read",
      "balance:withdraw",
      "complaints:handle",
    ];
    for (const p of allPerms) expect(can("owner", p)).toBe(true);
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
    for (const role of ALL_ROLES) {
      // @ts-expect-error
      expect(can(role, "fake:perm")).toBe(false);
    }
  });
});
