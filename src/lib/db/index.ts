import "server-only";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "file:./bindery.db";

// Next dev reloads modules on every edit. Without a global cache each reload
// opens a fresh libsql connection and the old ones leak.
const globalForDb = globalThis as unknown as {
  __binderyClient?: ReturnType<typeof createClient>;
};

const client =
  globalForDb.__binderyClient ??
  createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__binderyClient = client;
}

export const db = drizzle(client, { schema });
export { schema };
