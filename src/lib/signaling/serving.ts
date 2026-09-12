/**
 * An announced address is a claim, and the reader is the only party who can
 * check it - contract 4.
 *
 * The platform is handed an address by whoever announced it and never connects
 * to it, so it cannot tell you the machine at the other end is the contributor
 * the listing named. Anyone with a key can announce any address, including
 * somebody else's.
 *
 * What closes it is that a node states its own subject in everything it serves,
 * and the reader compares that against the subject the registry listed. That
 * comparison has to happen in the reader - browser or CLI - because it is the
 * only party in the request.
 *
 * This module stays free of fetch and of node: imports so both readers can
 * share it; what-each-side-learns.test.ts asserts that. address-is-not-a-claim
 * .test.ts asserts the check runs before content is rendered rather than after,
 * and that an impostor is reported as an impostor rather than as an unreachable
 * node - the two failures need different responses from a reader.
 */
export function servingMismatch(
  expected: string,
  claimed: string | undefined | null,
): string | null {
  if (!claimed) {
    return `The machine at this address does not say who it is. It was listed as ${expected}, and content that cannot be attributed is not worth reading.`;
  }
  if (claimed !== expected) {
    return `This address was listed as ${expected} but the machine answering says it is ${claimed}. Somebody has announced a node that is not theirs.`;
  }
  return null;
}
