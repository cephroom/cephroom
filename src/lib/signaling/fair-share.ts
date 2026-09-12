
export const LISTING_LIMIT = 200;

export const LISTING_SPREAD = 20;

export const LISTING_MIN_SHARE = 10;

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
