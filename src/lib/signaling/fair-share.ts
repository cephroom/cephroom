
/**
 * Round-robin decides who is visible; this decides how many bytes leave the
 * building. Without a cap a flood is still a flood, just an evenly distributed
 * one, and the response grows with the network rather than with the answer.
 */
export const LISTING_LIMIT = 200;

/**
 * The number of contributors a listing makes room for, whether or not that many
 * are online.
 *
 * Dividing the page by however many happen to be present sounds fair and is
 * not: on a quiet day it hands each of a handful of contributors a large share,
 * so somebody announcing five hundred items takes most of the page while the
 * honest few use three or four slots each. Sizing the share against a network
 * rather than against today's turnout stops a quiet day being a loud party's
 * opportunity, and costs nothing when everyone is behaving.
 */
export const LISTING_SPREAD = 20;

export const LISTING_MIN_SHARE = 10;

/**
 * Why this is a pure ordering and holds nothing - contract 2 meeting contract 1.
 *
 * The usual remedies for flooding are unavailable here. The platform cannot
 * judge what is being served, because it never sees content. It cannot remember
 * who misbehaved, because that is an activity record about a person. It cannot
 * rate-limit by identity without keeping one.
 *
 * Ordering needs none of that. Take one item from each contributor in turn and
 * a contributor with five hundred items occupies one slot per round exactly
 * like a contributor with one, so flooding costs the flooder their own page
 * space instead of everyone else's - which is the right party to charge.
 *
 * It must stay pure. discovery-is-fair.test.ts asserts this module reads no
 * wall clock and touches no process-global object, and that it does not appear
 * in the mutable-global scan. A "recent flooders" set would work, and would be
 * a behavioural record about named contributors sitting in the one module
 * nobody would think to look in.
 *
 * A plan buys none of this. Every online contributor gets the same share
 * whatever they pay; capacity buys how much work is eligible to fill it, and
 * copy-does-not-overstate.test.ts keeps the plan bullets honest about it.
 */
export function fairShare<T>(
  entries: T[],
  contributorOf: (entry: T) => string,
  limit: number = LISTING_LIMIT,
): T[] {
  const order: string[] = [];
  const queues = new Map<string, T[]>();

  for (const entry of entries) {
    const key = contributorOf(entry);
    let queue = queues.get(key);
    if (!queue) {
      queue = [];
      queues.set(key, queue);
      order.push(key);
    }
    queue.push(entry);
  }

  const share = Math.max(
    LISTING_MIN_SHARE,
    Math.ceil(limit / Math.max(order.length, LISTING_SPREAD)),
  );

  const out: T[] = [];
  for (let round = 0; round < share && out.length < limit; round += 1) {
    let placed = false;
    for (const key of order) {
      const queue = queues.get(key)!;
      if (round >= queue.length) continue;
      out.push(queue[round]);
      placed = true;
      if (out.length >= limit) break;
    }
    if (!placed) break;
  }

  return out;
}
