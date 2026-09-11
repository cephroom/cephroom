/**
 * fetch with a hard timeout, for talking to a contributor's node.
 *
 * A node is someone else's machine on an unknown network. A plain fetch to a
 * node that has stopped responding — not closed, just hung — never settles,
 * so the reader would spin forever with no error. This aborts after a bound
 * and surfaces a clean failure the reader turns into "node stopped answering".
 *
 * Browser-safe: no Node built-ins, uses the platform AbortController.
 */
export const NODE_FETCH_TIMEOUT_MS = 8000;

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = NODE_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    // A DOMException named AbortError means we timed out; give it a message a
    // reader can understand rather than the opaque default.
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`no response within ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
