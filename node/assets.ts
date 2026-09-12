import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, normalize, resolve, sep } from "node:path";

/**
 * A contributor serves their own figures, the same way they serve their columns
 * and datasets - contract 4.
 *
 * A figure that lived anywhere but the author's node would be a third-party
 * request the reader's browser makes on open: an off-node image URL is a
 * tracking pixel that leaks the reader's IP to whoever chose it, and it breaks
 * the provenance the whole platform rests on (the same reason a claim's dataset
 * must come from the node that served the claim). So figures live beside the
 * content, and the reader loads them only from the serving node - see
 * src/lib/node-asset.ts for the reader half.
 *
 * Two things this must not become: a path out of the content directory, and a
 * way to serve the columns themselves (or any non-media file) as bytes. Both
 * are refused below. Containment is checked twice - once on the resolved path
 * string, and once on its real path - because path.resolve does not follow
 * symlinks, so a link inside the content dir pointing outside it would pass the
 * string check and then be read straight through. Nodes run on POSIX, where
 * that link is trivial to create.
 */

export const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "video/ogg",
};

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

export interface ResolvedAsset {
  path: string;
  contentType: string;
  size: number;
}

export type AssetError =
  | "not-media"
  | "escapes-root"
  | "not-found"
  | "too-large";

function mediaType(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return null;
  return MEDIA_TYPES[name.slice(dot).toLowerCase()] ?? null;
}

/**
 * Resolves a requested asset name within a root, or says why it will not.
 *
 * The media-type gate is checked first and on the requested name, so a
 * traversal attempt dressed as ".png" is still refused for escaping, and a
 * request for "../server.ts" is refused as not-media before anything touches
 * the filesystem. Containment is verified on the resolved real path, not on the
 * string, so "." segments and separators cannot smuggle it out.
 */
export function resolveAsset(
  root: string,
  requested: string,
  realPath: (p: string) => string = realpathSync,
): ResolvedAsset | AssetError {
  const type = mediaType(requested);
  if (!type) return "not-media";

  const base = resolve(root);
  const full = resolve(base, normalize(requested));
  if (full !== base && !full.startsWith(base + sep)) return "escapes-root";

  if (!existsSync(full) || !statSync(full).isFile()) return "not-found";

  // Resolve symlinks and re-check: a link inside the root pointing outside it
  // would have passed the string check above.
  let real: string;
  try {
    real = resolve(realPath(full));
  } catch {
    return "not-found";
  }
  const realBase = existsSync(base) ? resolve(realPath(base)) : base;
  if (real !== realBase && !real.startsWith(realBase + sep)) return "escapes-root";

  const size = statSync(full).size;
  if (size > MAX_ASSET_BYTES) return "too-large";

  return { path: full, contentType: type, size };
}

export function readAsset(asset: ResolvedAsset): Buffer {
  return readFileSync(asset.path);
}

export function assetRoot(contentDir: string): string {
  const withAssets = join(contentDir, "assets");
  return existsSync(withAssets) ? withAssets : contentDir;
}
