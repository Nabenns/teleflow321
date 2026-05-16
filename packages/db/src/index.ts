import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type LapakgramDb = ReturnType<typeof createDb>;

export function createDb(url: string, options?: { max?: number }) {
  const client = postgres(url, { max: options?.max ?? 10 });
  return drizzle(client, { schema });
}

export { schema };
export * from "./schema/index.js";
