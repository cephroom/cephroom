/**
 * Checking that a node is who the registry said it was.
 *
 * The registry holds an `address` that arrived in an announcement. The
 * subject on that announcement is proven — it comes from a signed key — but
 * the address is just a string the announcer supplied, and nothing connects
 * the two. Running two contributors at once showed what that allows: one
 * announced the other's address under his own subject, and readers were told
 * "servedBy Marcus" while fetching Ines's machine.
 *
 * The platform cannot close this. Probing an announced address would put it
 * in a request to a contributor's node, which is the one thing Contract 2
 * keeps it out of — and it would not even work, since a node can answer a
 * probe honestly and serve whatever it likes to readers afterwards.
 *
 * The reader can close it, because the reader is the one actually connected.
 * The node states its subject in every response; the reader compares it with
 * the contributor it went looking for. That is "continuity is the endpoints'
 * job" doing real work rather than describing an absence.
 *
 * Kept pure and free of React and Node built-ins: the browser checks it, and
 * so does the CLI.
 */
export function servingMismatch(
  expected: string,
  claimed: string | undefined | null,
): string | null {
  if (!claimed) {
    return `The machine at this address does not say who it is. It was listed as ${expected}, and content that cannot be attributed is not worth reading.`;
  }
  // Exact. A subject is an opaque identifier, so a near-match is a different
  // contributor rather than a typo to be helpful about.
  if (claimed !== expected) {
    return `This address was listed as ${expected} but the machine answering says it is ${claimed}. Somebody has announced a node that is not theirs.`;
  }
  return null;
}
