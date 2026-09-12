<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Working on Cephroom

## Read tests/contracts/ first

Two constraints govern this platform: it persists nothing about users, and it
stores nothing anyone writes. They are not preferences. When a feature and a
contract conflict, the contract wins and the feature is cut.

The contracts used to be prose in `docs/CONTRACTS.md`. They are not any more —
that file was deleted, and the deletion took with it the only assertion
guarding the prohibition on platform-funded payouts, which had been written as
"this sentence appears in that document". A rule whose enforcement can be
removed by deleting a file nobody ships was never enforced. So the contracts
now live where they are executed:

| Contract | Where it is held |
| --- | --- |
| No persistence layer, no identity at rest | `tests/contracts/no-user-data.test.ts` |
| Identity stays in a named set of modules | `tests/contracts/identity-surface.test.ts` |
| A key states its plans and names nobody | `tests/contracts/key-carries-nothing.test.ts` |
| A proposal is attributed to a subject, never a person | `tests/contracts/attribution-is-pseudonymous.test.ts` |
| Two contributors cannot correlate a reader | `tests/contracts/readers-are-not-correlatable.test.ts` |
| An announced address is checked by the reader | `tests/contracts/address-is-not-a-claim.test.ts` |
| Exactly what each party can observe | `tests/contracts/what-each-side-learns.test.ts` |
| No content at rest, no proxying | `tests/contracts/no-content-at-rest.test.ts` |
| No durable state over HTTP, no content proxy | `tests/contracts/no-remote-state.test.ts` |
| Presence is never cached or prerendered | `tests/contracts/presence-is-not-an-archive.test.ts` |
| Not a social network | `tests/contracts/thesis.test.ts` |
| The bounded nullifier exception | `tests/contracts/nullifier-shape.test.ts` |
| Layer 1 unlinkability, and its wiring | `tests/contracts/unlinkability.test.ts`, `tests/contracts/anonymous-access.test.ts` |
| The platform verifies and never proves | `tests/contracts/prover-neutrality.test.ts` |
| Brokers connections, never value | `tests/contracts/brokers-connections-not-value.test.ts` |
| Money is integer minor units | `tests/contracts/money-is-integer.test.ts` |
| Identifiers derive from content | `tests/contracts/content-derived-ids.test.ts` |
| What the product claims matches what it does | `tests/contracts/stated-limits.test.ts` |
| The rules can actually fail | `tests/contracts/scanner.test.ts` |
| Continuity is the endpoints' job | `tests/node/presence-loop.test.ts` |

If you can make those tests pass while violating the spirit of a contract, the
test is wrong - fix the test. If you genuinely need to bend a contract, add it
to the allowlist that guards it, with a reason, in the test itself - every one
of them is written so that widening it is a visible diff.

**A source rule that has stopped matching looks exactly like a source rule
that is passing.** `tests/contracts/rules.ts` holds the scanning rules and
`scanner.test.ts` feeds each one known violations in the spellings somebody
would actually write. Four rules were silently inert for a long time because
`scan()` strips string literals before matching, so anything spelled as a
literal - a header name, a hostname - could never be seen. If you add a rule
about a literal, set `raw: true`, and add it to the scanner test. A rule with
no proof that it bites is decoration.

## Role-play at more than one of each

Run two contributors and several readers, or the interesting failures stay
invisible. Four of the findings in this repository's history were comparisons
between parties — two contributors seeing the same reader, two readers seeing
each other, a node's claim against the registry's — and a comparison needs two
of something. One contributor and one reader will pass every test and every
manual walk-through while all four are live.

Separate node processes with their own `--content`, `--sub` and `--pay-to`;
separate cookie jars per reader; tiers that actually differ. It takes about
twenty minutes to set up and it is where the last four privacy fixes came
from.

## Attacking this thing

Step 4 of the loop is to attack the running system from inside every role -
stranger, free-tier reader, contributor, former subscriber, colluding pair.

**Local dev server only.** The targets are `localhost:3000` and a node on
`127.0.0.1:4600`. Real sites are visited as a reader and never probed: not
scanned, not fuzzed, not tested for authorization bugs, however tempting the
finding. This is the one rule here that is about other people rather than
about the code, and the reason it is written down is that a competitive visit
and a penetration test start out looking identical from the inside.

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

**A bare space next to a closing inline JSX tag is not reliably a space.**
Three sentences shipped fused — `revoked.Revocation`, `independentPDSP`,
`NODE_KEYin` — from source that read `</strong> Revocation`, with the space on
the same line, in the same shape as a dozen sites that render correctly.
esbuild keeps the space; Next's SWC transform drops it in some of these
positions and I could not derive which. The source reads correctly, so review
will not catch it — only the rendered HTML shows it. Write the space as
`{" "}` on its own line and continue the prose on the next;
`tests/inline-spacing.test.ts` enforces that for closing tags. (The opening
side is not enforced: nothing has ever broken there, and a rule without
evidence is churn.)

**mdast `hProperties` keys reach hast verbatim**, not camelCased. The claim
element's key is read as `node.properties.claimkey`, lowercase, not
`dataClaimKey`.

**A key is handed to parties we do not control.** A reader's browser presents
a freshly minted node key to a *contributor's machine* on every read. So
anything in a key is something a stranger learns. It carried the Google
display name for a while, which meant reading a column told its author who you
were, and proposing an edit wrote that name to their disk permanently as
`fromName`. It also carried the Stripe customer id, which made the credential
a fourth copy of Stripe's records. Both are gone; a key now states a subject,
a tier and its scopes, and `tests/contracts/key-carries-nothing.test.ts` pins
the claim set exactly. Before adding a field, ask who ends up holding it.

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
| Which plans a subscription amounts to | `src/lib/access.ts` |
| The claim grammar | `src/lib/claims/syntax.ts` |
| Verified / drifted / broken | `src/lib/claims/verdict.ts` |
| Which analysis a number came from | `src/lib/claims/method.ts` |
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

The consequence is that reading a subscription, minting a key and stamping the
plans into it are the production code paths in development too. Keep it that
way: a mock of our own billing logic would test nothing.

Note what `src/lib/access.ts` is and is not. It answers *which plans a
subscription amounts to* — a discovery plan and a serving plan, read from
Stripe, independent of each other. It does not answer who may read what,
because nobody may be stopped from reading anything: work is served whole by
the contributor to whoever asks, and a consumer's plan never crosses that
connection. `tests/contracts/a-key-unlocks-nothing.test.ts` is the assertion
that there is nowhere left to put a gate.

## Data honesty

This is a publication about evidence quality, and the codebase is held to the
same standard as the columns.

- Empty dataset cells are dropped when the node reads them, never null-filled,
  so a claim against one fails loudly instead of resolving to "no data".
- The judge never converts between units or activity types. A unit mismatch is
  `broken`.
- **A value is rendered with the spread the dataset reports around it**, not as
  its centre. `59.45 %` becomes `59.45 ± 3.33 %` wherever a dispersion exists;
  null where none is reported, never zero, because zero claims perfect
  precision and "not reported" is not that. **A tolerance is not an error bar**
  — it is how far the author will let the dataset drift before the sentence is
  flagged — and the two look alike side by side, which is why they are separate
  lines with separate selects. This was added after shipping a column that
  asserted a direction from a gap of 2.02 against a standard error of 2.99,
  using a dataset whose standard deviations the node was dropping on the floor.
- **A number that depends on how it was computed carries the analysis that
  produced it, and `method:` has no default.** Where a cell exists under more
  than one analysis, a claim that names none resolves `broken` and lists them.
  Not a warning and not a pooled average, because both are slower ways of not
  being told. The evidence for making it hard rather than optional is in
  the competitive review: NeuroVault's schema has ~60 pipeline fields and
  they are empty on NARPS's own submissions. Optional provenance is not
  collected.
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
