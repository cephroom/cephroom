import type { Plan } from "@/lib/access";

export interface Authorable {
  id: string | null;
  role: string;
  plan: Plan;
}

/**
 * Who can write here.
 *
 * Editors and authors by role, and anyone on the Lab plan - authoring with
 * your own datasets is what Lab is sold on, so it has to actually unlock the
 * studio rather than only the reading of lab columns.
 */
export function canAuthor(viewer: Authorable): boolean {
  if (!viewer.id) return false;
  return (
    viewer.role === "author" || viewer.role === "editor" || viewer.plan === "lab"
  );
}

export function canEditColumn(
  viewer: Authorable,
  column: { authorId: string },
): boolean {
  if (!viewer.id) return false;
  return viewer.id === column.authorId || viewer.role === "editor";
}

/** Turns a title into a URL slug. Collisions are resolved by the caller. */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72)
      .replace(/-+$/, "") || "untitled"
  );
}

/** Reading time over prose with claim blocks already stripped. */
export function readingMinutes(prose: string): number {
  const words = prose.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
