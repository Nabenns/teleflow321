export const ROLES = ["owner", "admin", "finance", "support"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
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
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set<Permission>(PERMISSIONS),
  admin: new Set<Permission>([
    "merchant:billing:read",
    "members:invite",
    "members:remove",
    "members:change-role",
    "products:read",
    "products:write",
    "orders:read",
    "orders:refund",
    "balance:read",
    "complaints:handle",
  ]),
  finance: new Set<Permission>([
    "merchant:billing:read",
    "merchant:billing:write",
    "orders:read",
    "balance:read",
    "balance:withdraw",
  ]),
  support: new Set<Permission>(["products:read", "orders:read", "complaints:handle"]),
};

export function can(role: Role, perm: Permission): boolean {
  const set = ROLE_PERMS[role];
  if (!set) return false;
  return set.has(perm);
}

export function permsForRole(role: Role): Permission[] {
  const set = ROLE_PERMS[role];
  return set ? [...set] : [];
}
