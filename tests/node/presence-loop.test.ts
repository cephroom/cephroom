import { describe, expect, it } from "vitest";

import { PresenceLoop } from "../../node/presence";


function harness(options: {
  announce: () => Promise<number>;
  beat?: () => Promise<number | null>;
}) {
  const timers: { at: number; fn: () => void }[] = [];
  let now = 0;

  const loop = new PresenceLoop({
    announce: options.announce,
    beat: options.beat ?? (async () => 200),
    schedule: (ms, fn) => {
      const timer = { at: now + ms, fn };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (handle) => {
      const index = timers.indexOf(handle as unknown as (typeof timers)[number]);
      if (index >= 0) timers.splice(index, 1);
    },
  });

  const advance = async (ms: number) => {
    const target = now + ms;
    for (let guard = 0; guard < 1000; guard += 1) {
      const next = timers
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      timers.splice(timers.indexOf(next), 1);
      now = Math.max(now, next.at);
      next.fn();
      for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    }
    now = target;
  };

  return { loop, advance, pending: () => timers.length };
}

describe("a node that cannot announce keeps trying", () => {
  it("retries when the very first announce fails", async () => {
    let attempts = 0;
    const { loop, advance } = harness({
      announce: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("fetch failed");
        return 15;
      },
    });

    await loop.start();
    expect(attempts).toBe(1);
    expect(loop.connected()).toBe(false);

    await advance(60_000);
    expect(attempts).toBeGreaterThanOrEqual(3);
    expect(loop.connected()).toBe(true);

    loop.stop();
  });

  it("backs off rather than hammering a platform that is down", async () => {
    const delays: number[] = [];
    const timers: { at: number; fn: () => void }[] = [];
    let now = 0;

    const loop = new PresenceLoop({
      announce: async () => {
        throw new Error("down");
      },
      beat: async () => 200,
      schedule: (ms, fn) => {
        delays.push(ms);
        const t = { at: now + ms, fn };
        timers.push(t);
        return t as unknown as ReturnType<typeof setTimeout>;
      },
      cancel: () => {},
    });

    await loop.start();
    for (let i = 0; i < 6; i += 1) {
      now += 600_000;
      const due = timers.splice(0, timers.length);
      for (const t of due) t.fn();
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(delays.length).toBeGreaterThan(2);
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(loop.maxBackoffMs);
    loop.stop();
  });

  it("resets the backoff once it gets through", async () => {
    let fail = true;
    const delays: number[] = [];
    const timers: { at: number; fn: () => void }[] = [];

    const loop = new PresenceLoop({
      announce: async () => {
        if (fail) throw new Error("down");
        return 15;
      },
      beat: async () => 200,
      schedule: (ms, fn) => {
        delays.push(ms);
        timers.push({ at: 0, fn });
        return {} as ReturnType<typeof setTimeout>;
      },
      cancel: () => {},
    });

    await loop.start();
    for (let i = 0; i < 4; i += 1) {
      const due = timers.splice(0, timers.length);
      for (const t of due) t.fn();
      await Promise.resolve();
      await Promise.resolve();
    }
    const backedOff = delays[delays.length - 1];

    fail = false;
    const due = timers.splice(0, timers.length);
    for (const t of due) t.fn();
    await Promise.resolve();
    await Promise.resolve();

    expect(delays[delays.length - 1]).toBeLessThan(backedOff);
    loop.stop();
  });
});

describe("a connected node re-announces when the platform forgets", () => {
  it("re-announces on a lapsed lease", async () => {
    let announces = 0;
    const { loop, advance } = harness({
      announce: async () => {
        announces += 1;
        return 15;
      },
      beat: async () => 410,
    });

    await loop.start();
    expect(announces).toBe(1);

    await advance(30_000);
    expect(announces).toBeGreaterThan(1);
    loop.stop();
  });

  it("re-announces when the heartbeat cannot be delivered at all", async () => {
    let announces = 0;
    const { loop, advance } = harness({
      announce: async () => {
        announces += 1;
        return 15;
      },
      beat: async () => null,
    });

    await loop.start();
    await advance(30_000);
    expect(announces).toBeGreaterThan(1);
    loop.stop();
  });

  it("keeps beating quietly while the lease holds", async () => {
    let announces = 0;
    let beats = 0;
    const { loop, advance } = harness({
      announce: async () => {
        announces += 1;
        return 15;
      },
      beat: async () => {
        beats += 1;
        return 200;
      },
    });

    await loop.start();
    await advance(60_000);

    expect(announces).toBe(1);
    expect(beats).toBeGreaterThan(5);
    loop.stop();
  });

  it("stops cleanly and schedules nothing further", async () => {
    const { loop, advance, pending } = harness({ announce: async () => 15 });
    await loop.start();
    loop.stop();
    await advance(60_000);
    expect(pending()).toBe(0);
    expect(loop.connected()).toBe(false);
  });
});
