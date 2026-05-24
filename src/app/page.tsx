import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { Article } from "@/types/article";

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}…`;
}

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("articles")
    .select("id, title, slug, excerpt, created_at")
    .eq("published", true)
    .order("created_at", { ascending: false });

  const articles = (data ?? []) as Pick<
    Article,
    "id" | "title" | "slug" | "excerpt" | "created_at"
  >[];

  return (
    <main className="flex min-h-screen flex-col items-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 px-6 py-20 text-white">
      <section className="max-w-3xl text-center">
        <div className="mb-8 text-8xl">🐙</div>

        <h1 className="mb-4 text-6xl font-bold tracking-tight sm:text-7xl">
          Cephroom
        </h1>

        <p className="mb-12 text-xl text-slate-300 sm:text-2xl">
          A community platform for sharing neuroscience knowledge.
        </p>

        <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
          <button className="rounded-full bg-white px-8 py-3 font-semibold text-slate-950 transition hover:bg-slate-200">
            Sign In
          </button>
          <button className="rounded-full border border-white/20 px-8 py-3 font-semibold text-white transition hover:bg-white/10">
            Explore Articles
          </button>
        </div>

        <p className="mt-16 text-sm text-slate-500">
          Read, run, fork, contribute — neuroscience knowledge that you can
          actually use.
        </p>
      </section>

      <section className="mt-24 w-full max-w-4xl">
        <h2 className="mb-8 text-3xl font-bold tracking-tight sm:text-4xl">
          Latest Articles
        </h2>

        {error ? (
          <p className="rounded-2xl border border-red-500/30 bg-red-950/30 p-6 text-sm text-red-200">
            Couldn&rsquo;t load articles right now. Please try again in a
            moment.
          </p>
        ) : articles.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-slate-300">
            No articles yet — be the first to contribute!
          </p>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2">
            {articles.map((article) => (
              <li key={article.id}>
                <Link
                  href={`/articles/${article.slug}`}
                  className="group block h-full rounded-2xl border border-white/10 bg-white/5 p-6 transition hover:border-white/30 hover:bg-white/10"
                >
                  <h3 className="mb-3 text-xl font-semibold text-white group-hover:text-white">
                    {article.title}
                  </h3>
                  {article.excerpt && (
                    <p className="mb-4 text-sm leading-relaxed text-slate-300">
                      {truncate(article.excerpt, 150)}
                    </p>
                  )}
                  <span className="text-sm font-medium text-slate-200 group-hover:text-white">
                    Read more →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
