import bcrypt from "bcrypt";

const COST = 12;

// NOTE: bcrypt silently truncates inputs longer than 72 bytes, so callers must
// enforce a max length upstream (or pre-hash with SHA-256 before calling).
// "passwordA".repeat(8) + "X" and "passwordA".repeat(8) + "Y" hash compatibly
// without this guard. Form validators in apps/web should cap at 72 bytes.
export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new Error("password must be a non-empty string");
  }
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
