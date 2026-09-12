<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Working on Cephroom

## Read docs/CONTRACTS.md, then tests/contracts/

Eleven contracts govern this project. They are authored, they are not derived
from the code, and they outrank it: where the code disagrees, the code changes.
They are written out in full in `docs/CONTRACTS.md`, together with the reason
each one exists, the tests enforcing it, and every place it is knowingly bent.

Read that file before changing anything. Then read the tests, because the
contracts are enforced by tests rather than by discipline — a suite that would
still pass after a user table appeared enforces nothing.

An earlier arrangement had the contracts as prose only, and the prohibition on
platform-funded payouts was "guarded" by a test asserting that a sentence
appeared in a document. The document was deleted and the guard went with it.
Worse, the replacement guard searched its own source file for a string that
appeared only in its own assertion — it could not fail. Both are fixed: the
reasoning lives in `docs/RESEARCH-NOTES.md` and the test asserts *that* file
carries it, which is falsifiable by deleting the section.

| Contract | Where it is held |
| --- | --- |
| 1. A GitHub for science, not a publishing SaaS | `thesis.test.ts`, `discovery-indexes-nothing.test.ts` |
| 2. No person-linkable data at rest | `no-user-data.test.ts`, `identity-surface.test.ts`, `no-remote-state.test.ts` |
| 2. Tokens do not degrade into identified search | `tokens-do-not-degrade-silently.test.ts` |
| 2. A node stores a scoped pseudonym, and expires it | `tests/node/proposal-subjects-are-node-scoped.test.ts` |
| 3. Authorization is a signature, never a lookup | `key-forgery.test.ts`, `key-carries-nothing.test.ts`, `an-outage-does-not-downgrade.test.ts` |
| 3. Signed expiry, verifiable by a node alone | `tests/node/platform-key-reaches-the-node.test.ts` |
| 3. Two contributors cannot correlate a reader | `readers-are-not-correlatable.test.ts`, `what-each-side-learns.test.ts` |
| 4. No content at rest, no proxying, no tombstones | `no-content-at-rest.test.ts`, `presence-is-not-an-archive.test.ts` |
| 4. An announced address is checked by the reader | `address-is-not-a-claim.test.ts` |
| 5. Brokers connections, never value | `brokers-connections-not-value.test.ts` |
| 6. No platform-funded payouts, ever | `brokers-connections-not-value.test.ts` |
| 7. Money is integer minor units | `money-is-integer.test.ts` |
| 8. Verifies proofs, never produces them | `prover-neutrality.test.ts` |
| 9. What the product claims matches what it does | `stated-limits.test.ts`, `copy-does-not-overstate.test.ts` |
| 10. The rules can actually fail | `scanner.test.ts` |
| — A key unlocks nothing; there is nowhere to gate | `a-key-unlocks-nothing.test.ts` |
| — Layer 1 unlinkability, and its wiring | `unlinkability.test.ts`, `anonymous-access.test.ts` |
| — The bounded nullifier exception | `nullifier-shape.test.ts` |
| — Identifiers derive from content | `content-derived-ids.test.ts` |
| — Continuity is the endpoints' job | `tests/node/presence-loop.test.ts` |

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

**A Privacy Pass batch can die while still looking current.** Issuer keypairs
live in memory and are keyed by epoch *number*, so restarting the platform
replaces the keypair behind an epoch that is still listed as live. Every
outstanding token stops verifying and nothing about it looks stale. This shipped:
the key page reported ten healthy tokens, every one of them dead, and each search
popped one, failed redemption silently, and fell through to the identified path —
the one mechanism that severs paying from searching, degrading into the thing it
prevents. Do not fix it by persisting the keys; that is storage, and contract 9
says the argument for it is the signal to stop. The wallet stores a fingerprint
of the issuer public key beside the batch and checks it against `/api/tokens/keys`
before spending. `spendToken` must never remove a token before redemption has
actually succeeded, and a dead batch must be said out loud rather than counted as
stock. The CLI has its own copy of this logic — fix both.

**A proposal must be attributed to a node-scoped pseudonym.** `n_…`, derived per
contributor, never the `s_…` platform subject. A platform subject is the same
identifier at every contributor, which is exactly what node-scoping exists to
prevent, and writing one to a contributor's disk cannot be undone. The node
refuses it at the door and the store refuses it on write; a store that finds one
already on disk redacts it to `n_withdrawn` in place on open. Scoped pseudonyms
themselves expire 90 days after a proposal is resolved. If you write a fixture,
use `n_`: the suite used to normalise `s_` in its own fixtures, which is part of
why the leak went unnoticed.

**There is no rule against Markdown.** A `scripts/check-no-docs.ts` once forbade
every `.md` file in the repository and every `/** */` doc comment. It was
withdrawn, not weakened: a column *is* a Markdown file with front matter,
`/contribute` documents that format, and the rule had caused the six demo columns
to be deleted, so a fresh clone served nothing while `/contribute` promised a
demo. Write prose where prose belongs. `no-content-at-rest.test.ts` now asserts
the demo content is present, and separately that no column has appeared under
`src/`, which is the thing that rule should have been guarding.

**mdast `hProperties` keys reach hast verbatim**, not camelCased. The claim
element's key is read as `node.properties.claimkey`, lowercase, not
`dataClaimKey`.

**A key is handed to parties we do not control.** A reader's browser presents
a freshly minted node key to a *contributor's machine* on every read. So
anything in a key is something a stranger learns. It carried the Google
display name for a while, which meant reading a column told its author who you
were, and proposing an edit wrote that name to their disk permanently as
`fromName`. It also carried the Stripe customer id, which made the credential
a fourth copy of Stripe's records. Both are gone, and so is the tier: a node key now
states a *node-scoped* subject (`n_…`, different at every contributor), its
scopes, and the contributor it is bound to — nothing about what the reader has
paid for, because a node has nothing to check. `key-carries-nothing.test.ts`
and `what-each-side-learns.test.ts` pin the claim set exactly. Before adding a field, ask who ends up holding it.

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

- `simulated-counterparties/google/provider.ts` plus `src/app/api/dev-oauth/*`
  is a real OAuth 2.0 provider. The hand-rolled code flow runs against it exactly as it will
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
npm run typecheck
npm run lint
npm run build      # type errors surface here that tsc alone may not
```

All three of the first commands run in CI (`.github/workflows/ci.yml`) on push
and pull request. Do not leave `lint` red: it was red for a while, which quietly
undercuts "enforced by tests rather than discipline" — a declared check that
nobody runs and that does not pass is not a check.

Then open the thing in a browser and look at it. Three of the bugs in this
repository's history — the unscanned Tailwind directory, the CRLF claim
parsing, a cancelled account still advertising a price — passed both of the
commands above and were only visible on the rendered page.
