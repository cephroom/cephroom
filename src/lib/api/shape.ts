
export const API_VERSION = "v1";

export interface Envelope {
  api: typeof API_VERSION;
  observedAt: string;
}

export function envelope(): Envelope {
  return { api: API_VERSION, observedAt: new Date().toISOString() };
}

/**
 * Every answer here is about right now, so nothing downstream may keep one.
 *
 * A cached presence answer is an archive with a short lease - contract 4 - and
 * the cache does not have to be ours for that to be true. A CDN, a browser, or
 * a proxy holding a listing for sixty seconds means an item stays discoverable
 * after the machine serving it has gone, which is the property this platform
 * says it does not have.
 *
 * presence-is-not-an-archive.test.ts asserts every route sends this, so a new
 * endpoint cannot inherit a default and quietly become cacheable.
 */
export const NO_STORE = { "cache-control": "no-store" } as const;

export function noStore<T extends Response>(response: T): T {
  response.headers.set("cache-control", "no-store");
  return response;
}

/**
 * Open to any origin, because there is nothing here to protect with an origin.
 *
 * These endpoints return a public listing and a locator - what is online and
 * where to fetch it. There is no ambient authority to steal: the listing is the
 * same for a stranger as for a subscriber except in how far it reaches, and
 * reach is carried by a bearer key the caller has to supply deliberately, never
 * by a cookie a browser would attach on its own.
 *
 * That is what makes a wildcard safe here and would not make it safe on a route
 * that acted on cookie-carried session state. The token redemption path
 * explicitly omits credentials for the mirror-image reason.
 */
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "600",
} as const;

export const HEADERS = { ...NO_STORE, ...CORS } as const;
