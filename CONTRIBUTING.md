# Contributing to Cephroom

Thanks for your interest in making Cephroom better. This guide covers how to contribute code and articles.

## Code contributions

1. **Fork** the repository on GitHub.
2. **Clone** your fork and create a feature branch off `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
3. **Install dependencies** and start the dev server:
   ```bash
   npm install
   npm run dev
   ```
4. **Make your changes.** Keep commits focused and write clear commit messages.
5. **Run the linter** before pushing — every PR is checked:
   ```bash
   npm run lint
   ```
6. **Open a pull request** against `main`. Describe what changed and why, and link any related issues.

### Code style

- ESLint (with `eslint-config-next`) runs on every PR. Fix warnings before requesting review.
- TypeScript strict mode is on. Prefer explicit types at module boundaries.
- Follow the existing Tailwind conventions in `src/app/page.tsx` (dark slate theme, rounded buttons, generous spacing).
- Default to Server Components in the App Router. Add `"use client"` only when needed.

## Article contributions

The article submission flow is still being built out. For now:

- Articles are stored in the Supabase `articles` table with Row Level Security.
- Once authentication is wired up, you'll be able to draft and publish articles directly through the app.
- In the meantime, open an issue describing the article you'd like to contribute and we'll coordinate.

## Reporting bugs

Open a GitHub issue with:

- What you expected to happen.
- What actually happened.
- Steps to reproduce.
- Your environment (OS, Node version, browser).

## Code of conduct

Be kind. Cephroom is a community for sharing knowledge — treat contributors and readers with respect.
