
export const API_VERSION = "v1";

export interface Envelope {
  api: typeof API_VERSION;
  observedAt: string;
}

export function envelope(): Envelope {
  return { api: API_VERSION, observedAt: new Date().toISOString() };
}

export const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * Marks a response uncacheable, and returns it.
 *
 * For the responses that cannot pass a header bag to a constructor — a
 * redirect, mostly. Every one of those in this codebase carries a
 * `Set-Cookie`, and a redirect that is allowed to be cached is a redirect a
 * shared cache can replay at the next person: a key issued to one reader,
 * handed to another. Nothing here has ever been observed doing that, which is
 * the point at which it is cheap to make impossible.
 *
 * The same reasoning covers the endpoints that answer about presence. An
 * intermediary holding `/api/v1/live` for a minute is a one-minute archive of
 * who was online, which is the thing the platform does not keep.
 */
export function noStore<T extends Response>(response: T): T {
  response.headers.set("cache-control", "no-store");
  return response;
}

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "600",
} as const;

export const HEADERS = { ...NO_STORE, ...CORS } as const;
