<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Working on Bindery

## Things that will bite you

**Tailwind's automatic source detection skips directories whose names contain
glob metacharacters.** Every dynamic App Router segment is one — `[slug]`,
`[id]`, `[handle]` — so those files were silently unscanned and rendered with
no utilities at all. `src/app/globals.css` pins it with an explicit
`@source "../**/*.{ts,tsx}"`. Do not remove that line.

**Form-submitted textarea values arrive with CRLF line endings.** HTML
normalises them on submission. The claim fence patterns anchor on a bare
newline, so before this was handled, saving from the studio silently recorded
zero claims while the live preview — which passes the string straight to a
server action — showed them all. `parseBody` normalises at the door; keep it
that way, and there are regression tests.

**mdast `hProperties` keys reach hast verbatim**, not camelCased. The claim
element's key is read as `node.properties.claimkey`, lowercase, not
`dataClaimKey`.

**Server actions are public endpoints.** Every one of them re-derives the
viewer and re-checks authorisation; none of them trust a hidden field. The
local billing controls in particular only act on the signed-in reader's own
subscription.

## Where the invariants live

Business rules are in pure modules with tests beside them, deliberately
separated from the code that reaches a database:

| Rule | Module |
| --- | --- |
| Who can read what | `src/lib/access.ts` |
| The claim grammar | `src/lib/claims/syntax.ts` |
| Verified / drifted / broken | `src/lib/claims/verdict.ts` |
| Stripe subscription → stored row | `src/lib/stripe/projection.ts` |
| Diffing a proposal | `src/lib/diff.ts` |

If you are about to encode a judgement call — what `past_due` means for
access, whether a unit mismatch is drift — it belongs in one of those, with a
test that states the decision rather than only exercising the code.

**The check engine takes its database handle as an argument**
(`src/lib/claims/engine.ts`). `runner.ts` binds the app's server-only handle;
the seed and release scripts pass their own. An earlier version had the
scripts carrying a second implementation of the same loop, which is how you
end up with a CI runner that disagrees with itself. Do not reintroduce that.

## Local counterparties, not local mocks

Two things cannot be provisioned on a developer machine: a Google OAuth client
and a Stripe account. Both are handled by mocking the *counterparty* rather
than our own code.

- `src/lib/auth/dev-oauth.ts` plus `src/app/api/dev-oauth/*` is a real OAuth
  2.0 provider. Auth.js runs its ordinary flow against it.
- `src/lib/stripe/local.ts` stores customers, subscriptions and invoices,
  serves a checkout page, and posts webhook events signed with Stripe's real
  signature scheme to our real webhook route.

The consequence is that signature verification, idempotency, the state machine
and the entitlement rules are the production code paths in development too.
Keep it that way: a mock of our own billing logic would test nothing.

## Data honesty

This is a publication about evidence quality, and the codebase is held to the
same standard as the columns.

- Empty dataset cells are dropped on import, never null-filled, so a claim
  against one fails loudly instead of resolving to "no data".
- The runner never converts between units or activity types. A unit mismatch
  is `broken`.
- `npm run db:release -- --simulate` writes values that are not from ChEMBL. It
  labels them in the dataset's release string and provenance notes, and the
  demo database is restored afterwards. If you add another simulation, label it
  the same way.

## Before committing

```bash
npm test
npm run build      # type errors surface here that tsc alone may not
```

Then open the thing in a browser and look at it. Three of the bugs in this
repository's history — the unscanned Tailwind directory, the CRLF claim
parsing, a cancelled account still advertising a price — passed both of the
commands above and were only visible on the rendered page.
