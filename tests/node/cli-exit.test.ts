import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "../contracts/scan";

/**
 * The CLI has to fail cleanly, because failing is half of what it does.
 *
 * Found while checking that the command line refuses an impersonated node.
 * It refused, printed the right explanation — and then:
 *
 *   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c
 *   exit code: 127
 *
 * `process.exit(1)` in the top-level error handler tears the process down
 * while sockets opened by `fetch` are still closing, and libuv aborts. The
 * exit code that reaches a caller is 127 — conventionally "command not
 * found" — rather than 1, so a script wrapping this tool cannot tell a
 * refusal from a missing binary.
 *
 * It was invisible until now because the error paths that existed all threw
 * *before* any node was contacted. Every path that fails after reaching a
 * node hits it, which now includes the one that exists specifically to
 * protect a reader from a node that is not who it claimed to be. A safety
 * check that crashes on the branch where it fires is not much of a check.
 */

describe("the command line exits the way a caller expects", () => {
  it("sets an exit code rather than tearing the process down", () => {
    // `process.exit()` does not wait for in-flight handles. The error path
    // runs after network calls by definition, so it is the one place in this
    // file where that distinction is load-bearing.
    const cli = stripCommentsOnly(
      readFileSync(join(ROOT, "scripts", "cephroom.ts"), "utf8"),
    );
    const handler = cli.slice(cli.lastIndexOf(".catch("));
    expect(handler).toContain("process.exitCode");
    expect(handler).not.toMatch(/process\.exit\s*\(/);
  });

  it("reports 1 when it cannot reach the platform at all", () => {
    // Exercised for real, because the failure was in process teardown and no
    // amount of reading the source would have shown it. Port 1 is reserved
    // and nothing will be listening.
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
    // So `cephroom read ... > file` leaves an empty file on failure rather
    // than a file containing an error message.
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
