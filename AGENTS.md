<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Working on Receptorome

## Read docs/CONTRACTS.md first

Two constraints govern this platform: it persists nothing about users, and it
stores nothing anyone writes. They are not preferences. When a feature and a
contract conflict, the contract wins and the feature is cut.

`tests/contracts/` enforces them. If you can make those tests pass while
violating the spirit of a contract, the test is wrong - fix the test. If you
genuinely need to bend a contract, add it to the "Where the contracts bend"
list with a reason, and expect the allowlist assertions to make that a visible
diff.

There is no database. Do not add one, do not add an ORM, and do not add a
cache keyed by identity. If something seems to need durable state, it almost
certainly belongs in the contributor's node or at Stripe.

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
viewer from their key and re-checks authorisation against Stripe; none trust a
hidden field. The simulated billing controls in particular confirm the
subscription belongs to the caller before touching it.

**Cookies cannot be set while rendering a page.** Re-issuing a key after a
billing change has to happen in a route handler or a server action, which is
why checkout returns through `/api/auth/restamp` rather than straight to
`/account`.

**A `Set-Cookie` on a route the browser reaches by a server-action `redirect()`
does not stick.** Real Stripe returns the browser to `/api/auth/restamp` as a
genuine top-level navigation, so that route's re-stamped key lands. The
*simulated* checkout completes inside a server action, and the redirect it
throws is followed as an RSC navigation that drops the intermediate route's
`Set-Cookie` — so a reader who just paid stayed stamped Reader until the key
next renewed. The fix is to re-stamp *inside* the action (`restampKey()`,
which uses `cookies().set()`) before redirecting, never to rely on a later
route hop to set the cookie. `tests/checkout-restamp.test.ts` guards it.

## Where the invariants live

Business rules are in pure modules with tests beside them, deliberately
separated from anything that touches a network or a cookie:

| Rule | Module |
| --- | --- |
| Who can read what | `src/lib/access.ts` |
| The claim grammar | `src/lib/claims/syntax.ts` |
| Verified / drifted / broken | `src/lib/claims/verdict.ts` |
| Presence, and when it lapses | `src/lib/signaling/registry.ts` |
| Minting and verifying keys | `src/lib/keys/tokens.ts` |
| Diffing a proposal | `src/lib/diff.ts` |

If you are about to encode a judgement call — what `past_due` means for
access, whether a unit mismatch is drift — it belongs in one of those, with a
test that states the decision rather than only exercising the code.

**The claim parser and the drift judge are shared three ways**: the
contributor's node parses with them, the reader's browser judges with them,
and the tests cover them. Keep them pure and free of Node built-ins, or the
browser half breaks.

## Local counterparties, not local mocks

Two things cannot be provisioned on a developer machine: a Google OAuth client
and a Stripe account. Both are handled by mocking the *counterparty* rather
than our own code.

- `src/lib/auth/dev-oauth.ts` plus `src/app/api/dev-oauth/*` is a real OAuth
  2.0 provider. The hand-rolled code flow runs against it exactly as it will
  against Google.
- `simulated-counterparties/stripe/` stores customers and subscriptions the
  way Stripe would, and the gateway switch decides which answers.

The consequence is that the entitlement rules, the key minting and the access
decisions are the production code paths in development too. Keep it that way:
a mock of our own billing logic would test nothing.

## Data honesty

This is a publication about evidence quality, and the codebase is held to the
same standard as the columns.

- Empty dataset cells are dropped when the node reads them, never null-filled,
  so a claim against one fails loudly instead of resolving to "no data".
- The judge never converts between units or activity types. A unit mismatch is
  `broken`.
- If you ever ship values that are not from the upstream source, label them in
  the dataset's own release string and notes, and restore the real snapshot
  afterwards.

## Before committing

```bash
npm test
npm run build      # type errors surface here that tsc alone may not
```

Then open the thing in a browser and look at it. Three of the bugs in this
repository's history — the unscanned Tailwind directory, the CRLF claim
parsing, a cancelled account still advertising a price — passed both of the
commands above and were only visible on the rendered page.
