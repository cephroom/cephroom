-- Articles table for Cephroom
-- Stores user-submitted neuroscience articles (Markdown content).

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  excerpt text,
  content text not null,
  -- author_id is nullable to allow seeding before any auth.users rows exist.
  -- The RLS INSERT policy still requires authenticated callers to set
  -- author_id = auth.uid(), so normal writes are always attributed.
  author_id uuid references auth.users(id) on delete cascade,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists articles_author_id_idx on public.articles (author_id);
create index if not exists articles_published_created_at_idx
  on public.articles (published, created_at desc);

-- Keep updated_at in sync on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_articles_updated_at on public.articles;
create trigger set_articles_updated_at
  before update on public.articles
  for each row
  execute function public.set_updated_at();

-- Row Level Security
alter table public.articles enable row level security;

-- Anyone (including anonymous) can read published articles.
create policy "Published articles are viewable by everyone"
  on public.articles
  for select
  using (published = true);

-- Authors can read their own articles regardless of publication state.
create policy "Authors can view their own articles"
  on public.articles
  for select
  to authenticated
  using (auth.uid() = author_id);

-- Authors can insert articles where they are the author.
create policy "Authors can insert their own articles"
  on public.articles
  for insert
  to authenticated
  with check (auth.uid() = author_id);

-- Authors can update their own articles.
create policy "Authors can update their own articles"
  on public.articles
  for update
  to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

-- Authors can delete their own articles.
create policy "Authors can delete their own articles"
  on public.articles
  for delete
  to authenticated
  using (auth.uid() = author_id);

-- Seed article. author_id is left NULL as a placeholder — set it to a real
-- auth.users.id in Supabase Studio once a user account exists.
insert into public.articles (title, slug, excerpt, content, author_id, published)
values (
  'Welcome to Cephroom',
  'welcome-to-cephroom',
  'A first post to test the article pipeline — runnable neuroscience knowledge, not just papers and links.',
  E'# Welcome to Cephroom\n\nCephroom is a community platform for sharing **neuroscience knowledge** — the kind you can actually read, run, fork, and contribute back to.\n\n## Why\n\nPapers, awesome-lists, and blogs all stop short of being directly usable. Cephroom aims to bridge that gap.\n\n## What''s next\n\n- Sign in and publish your first article.\n- Browse other contributors'' work.\n- Fork what looks useful.\n\n_This is a seed article — feel free to delete it once you''ve added your own._',
  null,
  true
)
on conflict (slug) do nothing;
