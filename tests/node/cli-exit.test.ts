import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "../contracts/scan";


describe("the command line exits the way a caller expects", () => {
  it("sets an exit code rather than tearing the process down", () => {
    const cli = stripCommentsOnly(
      readFileSync(join(ROOT, "scripts", "cephroom.ts"), "utf8"),
    );
    const handler = cli.slice(cli.lastIndexOf(".catch("));
    expect(handler).toContain("process.exitCode");
    expect(handler).not.toMatch(/process\.exit\s*\(/);
  });

  it("reports 1 when it cannot reach the platform at all", () => {
    const result = spawnSync(
      process.execPath,
      [join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), join(ROOT, "scripts", "cephroom.ts"), "read", "s_x", "y"],
      {
        env: { ...process.env, CEPHROOM_URL: "http://127.0.0.1:1" },
        encoding: "utf8",
        timeout: 60_000,
      },
    );

    expect(result.status, `stderr: ${result.stderr}`).toBe(1);
    expect(result.stderr).not.toContain("Assertion failed");
    expect(result.stderr).not.toContain("UV_HANDLE_CLOSING");
  });

  it("prints the reason to stderr and nothing to stdout", () => {
    const result = spawnSync(
      process.execPath,
      [join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), join(ROOT, "scripts", "cephroom.ts"), "read", "s_x", "y"],
      {
        env: { ...process.env, CEPHROOM_URL: "http://127.0.0.1:1" },
        encoding: "utf8",
        timeout: 60_000,
      },
    );

    expect(result.stdout.trim()).toBe("");
    expect(result.stderr.trim().length).toBeGreaterThan(0);
  });
});
