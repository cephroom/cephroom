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
