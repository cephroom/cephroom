import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsAndStrings, walk } from "./scan";


interface Temptation {
  name: string;
  why: string;
  pattern: RegExp;
}

const TEMPTATIONS: Temptation[] = [
  {
    name: "follower / following graph",
    why: "a persistent social graph — a stored relationship between two people",
    pattern: /\b(followerCount|followingCount|followUser|unfollowUser|followersOf)\b/,
  },
  {
    name: "stars / likes",
    why: "an engagement record about who liked what — a stored personal action",
    pattern: /\b(starCount|starredBy|toggleStar|likeCount|likedBy|addStar)\b/,
  },
  {
    name: "view / download counters",
    why: "an activity record; counting reads means remembering that reads happened",
    pattern: /\b(viewCount|viewsCount|downloadCount|readCount|incrementViews|trackView)\b/,
  },
  {
    name: "trending / popularity ranking",
    why: "ranking by popularity requires an aggregate activity record over people",
    pattern: /\b(trending|mostPopular|popularityScore|topContributors)\b/,
  },
  {
    name: "contribution calendar / streak",
    why: "a per-person history of activity over time — a stored profile artifact",
    pattern: /\b(contributionGraph|contributionCalendar|activityStreak|commitStreak)\b/,
  },
  {
    name: "notifications / inbox",
    why: "a per-user queue the server holds on their behalf — server-side memory of a person",
    pattern: /\b(notificationQueue|unreadCount|inboxItems|markNotificationRead)\b/,
  },
];

describe("Contract 0: the platform does not grow social-graph features", () => {
  const files = walk(join(ROOT, "src")).filter((f) => !f.includes(".test."));

  it.each(TEMPTATIONS)("has no $name ($why)", (temptation) => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = stripCommentsAndStrings(readFileSync(file, "utf8"));
      if (temptation.pattern.test(source)) {
        offenders.push(relative(ROOT, file).split(sep).join("/"));
      }
    }
    expect(
      offenders,
      `${temptation.name} is ${temptation.why}. It does not belong in a GitHub for science.\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("has no route segment named for a social feed", () => {
    const routes = walk(join(ROOT, "app"))
      .concat(walk(join(ROOT, "src", "app")))
      .map((f) => relative(ROOT, f).split(sep).join("/"));
    const banned = routes.filter((r) =>
      /\/(feed|trending|following|followers|notifications|inbox)\//.test(r),
    );
    expect(banned).toEqual([]);
  });
});
