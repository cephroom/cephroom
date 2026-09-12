
export const API_VERSION = "v1";

export interface Envelope {
  api: typeof API_VERSION;
  observedAt: string;
}

export function envelope(): Envelope {
  return { api: API_VERSION, observedAt: new Date().toISOString() };
}

export const NO_STORE = { "cache-control": "no-store" } as const;

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "600",
} as const;

export const HEADERS = { ...NO_STORE, ...CORS } as const;
