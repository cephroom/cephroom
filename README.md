# Cephroom 🐙

A community platform for sharing neuroscience knowledge.

## Vision

Papers, awesome-lists, and tutorial blogs all stop short of being directly
usable — you read them, then you have to rebuild everything yourself before you
can actually try anything. Cephroom is the missing layer in between: a place
where neuroscience knowledge is read, run, forked, and contributed back to as
working artifacts, not just words. The goal is a community where what you learn
on Monday becomes something you can run on Tuesday.

## Tech Stack

- **[Next.js 16](https://nextjs.org)** (App Router, Turbopack, React Server Components)
- **TypeScript** (strict mode)
- **[Tailwind CSS](https://tailwindcss.com)**
- **[Supabase](https://supabase.com)** — Auth + PostgreSQL with Row Level Security
- **[Vercel](https://vercel.com)** — Deployment

## Getting Started

### Prerequisites

- Node.js 20+ and npm
- A Supabase project (free tier is fine)

### Setup

```bash
git clone https://github.com/<your-org>/cephroom.git
cd cephroom/frontend
npm install
```

Create a `.env.local` file in the `frontend/` directory:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
```

Find these values in your Supabase project under **Project Settings → API**.

### Database

Run the migrations in `supabase/migrations/` against your Supabase project.
The fastest way is to paste the SQL into the **SQL Editor** in Supabase Studio
and run it. Migrations create the `articles` table and the Row Level Security
policies that gate access.

### Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you should see the
Cephroom homepage with any published articles.

## Project Structure

```
frontend/
├── src/
│   ├── app/                  # Next.js App Router pages
│   │   ├── page.tsx          # Homepage (lists articles)
│   │   └── articles/[slug]/  # Individual article view
│   ├── lib/
│   │   ├── supabase.ts        # Browser Supabase client
│   │   └── supabase-server.ts # Server (SSR) Supabase client
│   └── types/
│       └── article.ts         # Shared Article type
└── supabase/
    └── migrations/            # SQL schema migrations
```

## Contributing

PRs welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to fork, branch,
and submit a pull request, plus the article submission process.

## License

[MIT](./LICENSE)
