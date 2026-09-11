/**
 * Database handle for scripts that run outside Next (seed, import, Stripe
 * fixtures). src/lib/db is marked server-only, which tsx cannot import, so
 * scripts build their own client against the same schema.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { config } from "dotenv";

import * as schema from "../src/lib/db/schema";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const client = createClient({
  url: process.env.DATABASE_URL ?? "file:./bindery.db",
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });
export type Database = typeof db;
export { schema };
