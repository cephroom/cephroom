/**
 * Shared shapes and conventions for the v1 API.
 *
 * Two rules, easy to state and learned the hard way while walking both roles:
 *
 * **The API never carries content.** Contract 2 says bytes go from a
 * contributor's machine to a reader's machine and the platform is not in the
 * request path. So `/api/v1/read/...` returns an *address*, not a column. A
 * proxy endpoint would be more convenient and would quietly make the platform
 * a host — which is the one thing it must never be. Every response that points
 * at a node says so in the response, so nobody has to infer it.
 *
 * **Liveness answers about now.** There is no endpoint listing what has ever
 * existed, and there will not be one: an index of everything is a copy of
 * everything. There is no endpoint reporting who served what over time,
 * because that is an activity record about a person.
 */

export const API_VERSION = "v1";

/** Every response carries this, so a client always knows what it is holding. */
export interface Envelope {
  api: typeof API_VERSION;
  /**
   * When this answer was true. Liveness only — an answer about the present,
   * with no claim about the past and no promise about the future.
   */
  observedAt: string;
}

export function envelope(): Envelope {
  return { api: API_VERSION, observedAt: new Date().toISOString() };
}

export const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * CORS, wide open, on purpose.
 *
 * These endpoints carry no cookie-authenticated state — the read credential is
 * a bearer key obtained by spending an anonymous token — so there is no
 * cross-site request forgery surface to protect. Allowing any origin lets a
 * researcher's notebook, served from anywhere, talk to the API directly.
 */
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "600",
} as const;

export const HEADERS = { ...NO_STORE, ...CORS } as const;
