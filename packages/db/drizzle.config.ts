import "dotenv/config";
import type { Config } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for drizzle-kit");
}

export default {
  dialect: "postgresql",
  // Pass schema files explicitly (array form). The schema barrel
  // (`src/schema/index.ts`) uses NodeNext-style `.js` re-exports, which
  // drizzle-kit's loader does not remap to `.ts` source. Pointing directly
  // at the schema files bypasses that loader limitation while keeping
  // application code free to consume the barrel via tsc/Next.
  schema: ["./src/schema/platform.ts", "./src/schema/tenant.ts"],
  out: "./migrations",
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
} satisfies Config;
