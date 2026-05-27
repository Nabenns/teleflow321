import { beforeAll } from "vitest";
import { ensureTestDb } from "./db.js";

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL) return;
  const url = await ensureTestDb("lapakgram_test_web");
  process.env.TEST_DATABASE_URL = url;
  process.env.DATABASE_URL = url;
});
