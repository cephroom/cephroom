import { join, resolve } from "node:path";

/**
 * Where a node gets its content, and the rule that a bare node has none.
 *
 * The platform launches empty and an empty site is the architecture working:
 * there is no shipped corpus, a contributor brings their own, and nothing is
 * kept when they stop (contract 4). So `node` with no arguments must serve
 * nothing - not the demo. The demo columns live in the repository for local
 * development and are opt-in behind --demo; pointing --content somewhere is the
 * real use.
 *
 * An earlier pass had a bare node serve the demo and a page promising it, which
 * quietly implied the platform ships content. This is the correction, kept as a
 * pure function so the default is testable without launching a process.
 */
export interface ContentPaths {
  contentDir: string;
  dataDir: string;
  demo: boolean;
}

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
}

export function resolveContentPaths(
  args: string[],
  env: { CONTENT_DIR?: string; DATA_DIR?: string },
  nodeDir: string,
  cwd: string,
): ContentPaths {
  const demo = args.includes("--demo");
  const demoContent = join(nodeDir, "content");
  const demoData = join(nodeDir, "data");

  const contentFlag = flagValue(args, "content") ?? env.CONTENT_DIR;

  // A bare node - no --content, no CONTENT_DIR, no --demo - points at ./content
  // under the working directory, which in a fresh checkout does not exist, so
  // the node serves nothing. The demo path is reached only by asking for it.
  const contentDir = resolve(
    contentFlag ?? (demo ? demoContent : join(cwd, "content")),
  );

  const dataFlag = flagValue(args, "data") ?? env.DATA_DIR;
  const dataDir = resolve(
    dataFlag ?? (demo ? demoData : contentFlag ? contentDir : join(cwd, "content")),
  );

  return { contentDir, dataDir, demo };
}
