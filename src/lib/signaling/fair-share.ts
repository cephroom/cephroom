/**
 * Ordering a listing so that no contributor can crowd out the rest.
 *
 * Running five contributors with one hostile showed what the absence cost. A
 * contributor holding a legitimate key announced 500 items — within the
 * schema, every field inside its cap, nothing malformed — and took 97% of
 * discovery. A search for a real tag came back 506 results, 500 of them
 * hers. The `/read` page reached 1.67 MB.
 *
 * Discovery is the platform's only product surface, so burying it buries
 * everything. And the usual remedies are unavailable: the platform cannot
 * judge what is being served (it never sees content), cannot remember who
 * misbehaved (that is an activity record about a person), and cannot
 * rate-limit by identity without keeping one.
 *
 * Ordering needs none of that. Take one item from each contributor in turn,
 * and a contributor with 500 items occupies one slot per round exactly like a
 * contributor with one. Flooding then costs the flooder their own page space
 * instead of everyone else's, which is the right party to charge.
 *
 * Pure, stateless, and stable: the same input gives the same output, so a
 * listing does not reshuffle between requests.
 */

/**
 * The most items any single listing will return.
 *
 * Round-robin decides *who* is visible; this decides how many bytes leave the
 * building. Without it a flood is still a flood, just an evenly distributed
 * one. Two hundred is a page of discovery — enough that an honest listing is
 * never truncated in practice, small enough that the response stays in the
 * tens of kilobytes.
 */
export const LISTING_LIMIT = 200;

/**
 * The number of contributors a listing makes room for, whether or not that
 * many are online.
 *
 * Dividing the page by however many happen to be present sounds fair and is
 * not: with five contributors it hands each of them forty slots, so the one
 * announcing five hundred items still took 73% of the page while the honest
 * four used three or four slots apiece. Sizing the share against a network
 * rather than against today's turnout keeps a quiet day from being a loud
 * party's opportunity, and costs nothing when everyone is behaving — nobody
 * here serves ten columns, let alone forty.
 *
 * The consequence, stated rather than hidden: a genuinely prolific
 * contributor is sampled rather than listed in full. That is the honest
 * reading of a presence listing, which was never an index.
 */
export const LISTING_SPREAD = 20;

/**
 * The smallest share any contributor gets, however small the page.
 *
 * Without a floor the share is `limit / spread`, which is sensible at a page
 * of two hundred and cruel at fifty: a contributor serving five items had
 * three of them shown while the page sat two-thirds empty. The cap exists to
 * stop one contributor filling a page, not to truncate somebody who could
 * never fill one.
 */
export const LISTING_MIN_SHARE = 10;

export function fairShare<T>(
  entries: T[],
  contributorOf: (entry: T) => string,
  limit: number = LISTING_LIMIT,
): T[] {
  // Grouped in encounter order, so the result is a deterministic function of
  // the input — a listing that reshuffled between requests would look like
  // instability in the network rather than a choice made here.
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

  // An equal share of the page each. Round-robin alone decides who appears
  // first, and that already un-buries everyone — but the *tail* still fills
  // with whoever has the most to say, so a 200-item page stayed mostly one
  // contributor's. A share is the honest reading of "discovery is presence":
  // everyone present gets the same amount of room.
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
