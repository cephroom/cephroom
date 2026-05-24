import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { Article } from "@/types/article";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("articles")
    .select("id, title, slug, excerpt, content, author_id, created_at, updated_at, published")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();

  if (error || !data) {
    notFound();
  }

  const article = data as Article;
  const formattedDate = dateFormatter.format(new Date(article.created_at));

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 px-6 py-16 text-white">
      <article className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="mb-10 inline-block text-sm text-slate-400 transition hover:text-white"
        >
          ← Back to articles
        </Link>

        <header className="mb-12 border-b border-white/10 pb-8">
          <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl">
            {article.title}
          </h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
            <span>
              By{" "}
              <span className="font-mono text-slate-300">
                {article.author_id ?? "unknown"}
              </span>
            </span>
            <span aria-hidden>·</span>
            <time dateTime={article.created_at}>{formattedDate}</time>
          </div>
        </header>

        <div className="prose prose-invert prose-slate max-w-none prose-headings:tracking-tight prose-a:text-sky-300 prose-pre:rounded-xl prose-pre:border prose-pre:border-white/10 prose-pre:bg-slate-950">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {article.content}
          </ReactMarkdown>
        </div>
      </article>
    </main>
  );
}
