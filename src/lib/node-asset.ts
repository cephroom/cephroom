const MEDIA_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

const VIDEO_EXT = /\.(mp4|webm|ogg)$/i;

/**
 * Resolves a figure reference to a URL only if it is served by the node that
 * served the column - contract 2 and contract 4.
 *
 * A column is untrusted content from a stranger's machine, and an <img> is the
 * one place that content makes the reader's browser fetch a URL of the author's
 * choosing, automatically, on open. An off-node image URL is therefore a
 * tracking pixel: it leaks the reader's IP to whoever the author named, exactly
 * the connection reading is supposed not to reveal. It also breaks provenance -
 * a figure that came from somewhere other than the node cannot be vouched for
 * any more than a dataset served by a stranger can (see
 * datasets-come-from-the-same-node).
 *
 * So a figure must resolve to the serving node's own /asset/ route. A relative
 * reference (`fig.png`) resolves there; a same-origin absolute URL under
 * /asset/ is allowed; everything else - another origin, a protocol-relative
 * //host, a javascript: or data: URL, a path that climbs out of /asset/ -
 * returns null, and the reader shows a link the reader may choose to follow
 * rather than a picture it fetched for them.
 */
export function nodeAssetUrl(
  src: string | null | undefined,
  address: string,
): string | null {
  if (typeof src !== "string" || src.trim() === "") return null;

  let base: URL;
  try {
    base = new URL(address);
  } catch {
    return null;
  }

  let url: URL | null = null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) {
    try {
      url = new URL(src);
    } catch {
      return null;
    }
  } else if (src.startsWith("//")) {
    return null;
  } else {
    try {
      url = new URL(src.replace(/^\/+/, ""), `${base.origin}/asset/`);
    } catch {
      return null;
    }
  }

  if (!MEDIA_SCHEMES.has(url.protocol)) return null;
  if (url.origin !== base.origin) return null;
  if (!url.pathname.startsWith("/asset/")) return null;
  return url.href;
}

export function isVideoAsset(url: string): boolean {
  try {
    return VIDEO_EXT.test(new URL(url).pathname);
  } catch {
    return VIDEO_EXT.test(url);
  }
}
