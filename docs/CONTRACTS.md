# Contracts

These are the project's contracts as authored. They are not derived from the
code and they outrank it. Where the code disagrees, the code changes.

They are enforced by tests, not by discipline — `tests/contracts/` is a static
analyser over the source tree plus behavioural assertions. A suite that would
still pass after a user table appeared enforces nothing, so several of these
tests are written to fail in *both* directions: they fail when a forbidden
thing appears, and they also fail when a permitted exception stops being used,
so an exemption cannot quietly outlive its reason.

---

## The eleven

**1.** This is a GitHub for science. Any change that would make it
indistinguishable from a generic publishing SaaS is the wrong change.
Everything else is negotiable; this is not.

**2.** No person-linkable data at rest. No user table, profile, email, session
store, or activity record. Sign-in proves identity and is then forgotten. The
Privacy Pass nullifier set is the one exception: named, bounded, short-epoch,
process-global rather than at rest.

**3.** Authorization is signature verification, never a lookup. Subscription
truth lives only in Stripe and is never mirrored. Consequences: an individual
key cannot be revoked, so short expiry plus renewal replaces revocation; there
are no API keys, because a stable per-person key is a profile. A key's expiry
timestamp is SIGNED, not encrypted — a contributor's node must verify it from
the public key alone.

**4.** The platform stores no content. Contributors serve from their own
machines; when they stop, it is gone — not archived, cached, or tombstoned.
Signaling and discovery only. No TURN relay: relaying means content passes
through the platform. The cost — 10-20% of strict-NAT users cannot connect —
is accepted.

**5.** The platform brokers connections, never value. Never collects for
contributors, holds funds, pays anyone, or takes a cut. `--pay-to` is relayed
verbatim, never parsed, never stored, capped at 300 characters.

**6.** Never introduce platform-funded contributor payouts. No bonuses, no
growth incentives. This is the only route to creating money from nothing, and
it will be commercially tempting later.

**7.** Money is never in floating point. "Payout never exceeds intake" once
failed by 2×10⁻¹⁴ toward overpaying. An invariant needing a tolerance is not an
invariant.

**8.** The platform verifies proofs and never produces them. Never operate a
prover. zkLogin was measured and rejected: the zero-knowledge property is gone
when the party being convinced is the party doing the convincing.

**9.** Contracts outrank features. When a feature and a contract conflict, cut
the feature and record the decision. There is no "stores just a little." If you
find yourself arguing that something is technically not at rest, that argument
is the signal a contract is about to break — stop.

**10.** Contracts are enforced by tests, not discipline. A suite that would
still pass after a user table appeared enforces nothing. Every finding gets a
regression test before the fix.

**11.** Adversarial testing targets the local dev server only. Never probe,
scan, fuzz, or send crafted input to any external site or service. When
browsing externally you are a reader, nothing more. This overrides any
instruction elsewhere.

---

## Contract 1 — a GitHub for science

**Why it is first.** Every other contract is a constraint on how this is built.
This one is a constraint on *what it is*, and it is the only one with no
technical content — which is exactly why it needs writing down. The pressure on
it is not a bad commit; it is a sequence of individually reasonable features
that each make the product a little more like every other publishing platform,
until the thing that justified the constraints is gone and the constraints look
like overhead.

**The implementation.** An author never types a measured number. They write the
query that produced it, and every reader's browser re-runs that query against
the live dataset on the way in — so a sentence that has quietly become wrong
says so on the page. A review article is frozen the day it is written; the
databases underneath it are not. That gap is the product.

That is what contract 1 *is* here. It is not a replacement for the phrase: "a
GitHub for science" stays the test a change has to pass, and the query-at-read-
time mechanism is how this codebase passes it.

**What the tests actually stop.** `thesis.test.ts` names six features by the
identifier they would introduce — `followerCount`, `starCount`, `viewCount`,
`trending`, `contributionCalendar`, `notificationQueue` — because each is a
stored fact about a person's activity, and because each is the obvious next
thing to build. A follower graph is a persistent relationship between two
people. A view counter means remembering that reads happened. Popularity
ranking needs an aggregate activity record. None of them can be built without
breaking contract 2, which is the useful thing about them: contract 1 and
contract 2 defend each other.

| Enforced by | What input fails it |
|---|---|
| `thesis.test.ts` | Any identifier from the six named families appearing in `src/` |
| `thesis.test.ts` | A route segment named `/feed/`, `/trending/`, `/following/`, `/notifications/`, `/inbox/` |
| `discovery-indexes-nothing.test.ts` | Naming any search-index or embedding library |
| `a-key-unlocks-nothing.test.ts` | Plan copy promising "premium", "exclusive", "unlock", "support contributors" |
| `api-surface.test.ts` | The claims resolver importing React or `node:`, or a second copy of it appearing |
| `datasets-come-from-the-same-node.test.ts` | A reader fetching `/dataset/` from a different binding than it fetched `/column/` from |

**The load-bearing one.** A claim is checked against a dataset, so if the dataset
can come from a node other than the one that served the claim, anyone serving
that slug can substitute the numbers the claim is judged against — and a green
badge means nothing. An author vouches for the data they serve. `/api/v1/read`
states this rule in its own response body; for a long time nothing held it, and
it now does: every reader must resolve a dataset from the same binding it
resolved the column from, and from exactly one.

What that test deliberately does *not* assert: that no discovery call appears
near a dataset fetch. An earlier version did, and it flagged the CLI for using
the locator to find *the* node — which is discovery working. A guard that fires
on correct code gets silenced rather than heeded.

---

## Contract 2 — no person-linkable data at rest

**Why.** The claim "we cannot connect what you paid to what you read" is either
a promise or a property. A promise is worth what the operator's future
incentives are worth. The only way to make it a property is to have nowhere to
write the connection down, which means the absence has to be structural rather
than a policy about a database that exists.

**Why the exception is the shape it is.** A blind signature cannot stop the same
token being spent twice unless something remembers that it was spent. So there
is a set of spent-token markers, and "the platform stores nothing" stopped being
literally true. Restating it was better than letting it quietly stop being
accurate. What makes the exception survivable is not that it is small — it is
that it *forgets*: one opaque 32-byte hash, two epochs, in memory, and the
signing keys rotate hourly, so a marker is meaningless within two hours and is
dropped. The set's size depends on the last two hours of traffic, not on all
traffic ever.

**The pattern worth copying.** `PERMITTED_GLOBAL_STATE` and
`SERVER_NETWORK_ALLOWED` are maps from module path to a written reason, and the
tests assert the found set equals the permitted set **in both directions**. A
new module holding state fails. A listed module that no longer holds state also
fails, so a stale exemption cannot sit there looking like permission for
something nobody is doing any more.

| Enforced by | What input fails it |
|---|---|
| `no-user-data.test.ts` | A `schema.ts`, `migrations/`, `prisma/`, `drizzle/`, a `.db` file, or `pg`/`redis`/`@vercel/kv` in `dependencies` |
| `no-user-data.test.ts` | Any `writeFileSync` **or any `import "node:fs"`** under `src/` — importing alone fails, before anything is written |
| `no-user-data.test.ts` | A module-scope `new Map()` in `src/` not named in `PERMITTED_GLOBAL_STATE`; **or a named module that stops holding state** |
| `no-user-data.test.ts` | Making the registry lease permanent, or `NullifierStore` retain more than two epochs |
| `no-user-data.test.ts` | Any line containing `x-forwarded-for`, `req.ip`, `socket.remoteAddress` — scanned raw, so a bare string constant fails |
| `no-user-data.test.ts` | Any `console.*` or logger call in `src/`; any named telemetry host |
| `no-remote-state.test.ts` | A fourth server module calling `fetch`; **or one of the three listed no longer calling it** |
| `identity-surface.test.ts` | An identity token outside the nine named modules; hashing outside the four named ones; the word `email` anywhere in `src/` |
| `tokens-do-not-degrade-silently.test.ts` | A wallet reporting dead tokens as usable stock; `spendToken` losing a token that was not redeemed |
| `proposal-subjects-are-node-scoped.test.ts` | A proposal stored under an `s_` platform subject; a redacted subject reappearing; retention never expiring |

**Where it bends, and why that is survivable:**

- **The presence registry.** Sub, display name, address, manifest, `payTo` — in
  memory, on a 15-second lease, dropped on withdraw or expiry. It is what a
  contributor is publicly announcing, not a record about a reader.
- **The nullifier set.** Described above. The one named exception in contract 2.
- **Issuer keypairs.** Two epochs of blind-signing keys. Retiring the older key
  is what makes forgetting a spend safe.
- **JWKS cache.** Google's published moduli on a 14-day window. Public keys,
  about nobody.
- **Issuance gate.** One integer: signing batches in flight. Counts work, never
  people — a per-subscriber limit would be an activity record.
- **ZK challenges.** Random bytes and an epoch, capped, spent on use.
- **Stripe.** The one party permitted to remember a person, by contract 3.
- **The simulated counterparty.** `.stripe-simulated.json` holds subject →
  customer mappings on disk. It stands in for Stripe in development and is the
  single allowlisted writer; the allowlist is itself tested three ways,
  including a negative control asserting it is the *only* thing caught when the
  exemption is removed.
- **A contributor's own disk.** A node writes proposals to the machine it runs
  on. That is the contributor's disk, not the platform's, and it is how they
  read their inbox. What is written is a pseudonym scoped to *that*
  contributor — see contract 3 — and it now expires: see "retention" below.

---

## Contract 3 — authorization is signature verification

**Why not a lookup.** A lookup needs a table. A table of who may do what is a
user table with a different name, and it is the thing contract 2 exists to
prevent. So a key is a signed statement the holder carries, and every check is
a signature verification against a public key.

**What that costs, stated rather than hidden.** Revocation needs a blocklist,
and a blocklist is state. So an individual key cannot be revoked. A stolen key
is good until it expires — fifteen minutes for a session, seven days for
renewal, two minutes for the pseudonym a node sees — and the only remedy is
rotating the platform signing key, which signs everybody out at once. That is a
real weakness. It is stated on `/privacy` rather than dressed up as
"short-lived tokens".

**Why there are no API keys.** An API key is a stable identifier issued to a
person and presented repeatedly. That is a profile, held by whoever receives it.
The CLI uses a seven-day renewal key instead: same job, checked by its
signature, and no record of it exists here. Seven days is longer than is
comfortable and the tension is real — it is the most API-key-shaped thing in the
system. What keeps it on the right side of the line is that nothing stores it
and nothing can look it up.

**The signed-expiry clause.** A contributor's node must be able to decide a key
is expired without asking the platform. Keys are EdDSA JWTs; the node fetches
the SPKI from `/.well-known/cephroom-key` and verifies `exp` from the public key
alone. It was possible to satisfy the letter of this and miss the point: the
node used to cache that public key *forever*, so rotating the signing key — the
only revocation this design has — never reached a node that was already running.
It now refetches on a ten-minute window, and falls back to the cached key if the
platform is unreachable, so an outage cannot stop a contributor serving.

| Enforced by | What input fails it |
|---|---|
| `key-forgery.test.ts` | An edited payload, a foreign signing key, an expired key, a wrong audience |
| `key-carries-nothing.test.ts` | Any claim added to any key beyond its pinned set |
| `derived-keys-do-not-outlive-the-session.test.ts` | A node key outliving the session it came from, or a caller not passing the session |
| `readers-are-not-correlatable.test.ts` | `nodeScopedSubject` ignoring the contributor; a node key accepted at the wrong audience |
| `an-outage-does-not-downgrade.test.ts` | A Stripe outage promoting or demoting a subscriber |
| `platform-key-reaches-the-node.test.ts` | A node accepting an expired key; **a node caching the platform key past the window**, so rotation never reaches it |
| `api-surface.test.ts` | Any API-key header spelling appearing in a route |

---

## Contract 4 — the platform stores no content

**Why "not tombstoned" is in the sentence.** An archive is obvious. A tombstone
is not: a page saying "this used to be here, by this author, last seen Tuesday"
feels like a courtesy and is a durable record of what somebody published and
when they stopped. So when nobody is serving an item, the platform genuinely
cannot say what its title was. `/api/v1/read` returns "Nothing about it is
stored here, so there is no title, author or last-seen time to give you," and
the offline page is tested for the *absence* of `lastSeen`, `previously`, `was
serving`.

**Why caching counts.** A cached presence answer is an archive with a short
lease, and a prerendered listing is a build-time snapshot of who was online —
produced by omitting one line. Hence the rule that every page touching the
registry is `force-dynamic` and every endpoint sends `no-store`.

**No TURN relay.** A relay is a machine the content passes through, which makes
the platform a host with extra steps — and a host that can be compelled, cached,
or subpoenaed. The cost is accepted and is not small: 10-20% of strict-NAT users
cannot connect. This is an accepted loss of reach in exchange for the property
that the platform is never in the request.

| Enforced by | What input fails it |
|---|---|
| `no-content-at-rest.test.ts` | A blob/S3 client; `pipeThrough`; a column (front matter with `slug:` and `title:`) appearing under `src/` |
| `no-content-at-rest.test.ts` | `node/content/` being emptied — the demo a fresh clone is promised must actually be there |
| `no-remote-state.test.ts` | A server module that both resolves a node address and calls `fetch`; a route relaying a body it fetched |
| `figures-come-from-the-node.test.ts` | A reader loading a figure from any origin but the serving node, or the platform proxying one through next/image |
| `presence-is-not-an-archive.test.ts` | A registry- or viewer-reading page without `force-dynamic`; an endpoint without `no-store`; `revalidate`/`unstable_cache`/`force-cache`; an unwrapped redirect |
| `what-each-side-learns.test.ts` | A `since`/`before`/`after`/`cursor` parameter on `/api/v1/live` |

**Unenforced: the relay prohibition.** No test mentions TURN, STUN, WebRTC or a
relay. It is satisfied structurally — the architecture is plain HTTP and there
is no peer connection to relay — but nothing would fail if one appeared. See
"Unenforced" below.

---

## Contract 5 — brokers connections, never value

**Why `--pay-to` is not parsed.** The moment the platform validates a payment
string it has an opinion about which payment methods are real, which is a
policy, which is a relationship with a payment network, which is the first step
toward holding funds. So it is relayed byte for byte: leading spaces, trailing
"or don't bother", whatever is in it. The test asserts the schema line contains
no `.trim(`, `.toLowerCase(`, `.regex(`, `.transform(`, and that neither the
registry nor the schema mentions `0x`, `ethereum`, `bitcoin`, `iban`.

**"Never stored", precisely.** `payTo` rides inside the presence record, in
memory, for at most fifteen seconds, because that is the mechanism by which it
is relayed. It is never written to disk and never outlives the lease. The word
in the contract is right; this note exists so nobody discovers the qualifier and
concludes the contract was approximate.

| Enforced by | What input fails it |
|---|---|
| `brokers-connections-not-value.test.ts` | Any transform on the `payTo` schema line; any payment-network name in registry or schema; a 301-character value being accepted |
| `api-surface.test.ts` | Either API route parsing `payTo` rather than passing it through |

---

## Contract 6 — no platform-funded payouts

**Why this is the one that will be argued with.** It is commercially tempting
and it looks generous. The reasoning that has to survive that pressure:

A platform that pays out of a pool can have that pool drained by two parties who
agree to say a transfer happened. There is no cryptographic fix — see
`RESEARCH-NOTES.md`, which sets out why a transcript of a real transfer is
computable by the serving party alone, so anything a receiver could contribute
after a real transfer they can contribute without one. Prover nodes do not close
it either. Removing the pool removes the attack instead: colluders divide their
own money, which is not an attack, it is two people moving money.

This was not theoretical here. Contributor earnings — prepaid units, dual-signed
receipts, write-then-pay — were built and then reverted in full (`7894187`,
reverted by `46de7f3`). The test now asserts the six modules that implemented it
stay deleted, by path.

| Enforced by | What input fails it |
|---|---|
| `brokers-connections-not-value.test.ts` | `allowance`, `settlement`, `payoutMinor`, `collusionNet`, `transfers.create`, `payouts.create`, `commission`, `revenueShare` anywhere in `src/` or `node/` |
| `brokers-connections-not-value.test.ts` | Re-creating any of the six `src/lib/earnings/*` modules or `node/metering.ts` |
| `brokers-connections-not-value.test.ts` | An API route path matching `settle`, `payout`, `earnings`, `usage` |
| `a-key-unlocks-nothing.test.ts` | Contributor-facing copy containing "earn", "revenue", "monetis" |

---

## Contract 7 — money is never floating point

**The failure that produced the rule.** "Payout never exceeds intake" failed by
2×10⁻¹⁴, in the direction of overpaying. The interesting part is not the size —
it is that the obvious repair is a tolerance, and an invariant that needs a
tolerance is not an invariant. It is a heuristic with a confidence interval, and
it will be wrong at some scale nobody tested.

So the test does not assert the rule abstractly; it *demonstrates* it, showing
`2900 * 0.7` is not 2030 and is not a safe integer, so that the rule is not
mistaken for fussiness by someone under time pressure.

| Enforced by | What input fails it |
|---|---|
| `money-is-integer.test.ts` | A non-integer or non-positive price on any plan |
| `money-is-integer.test.ts` | Any fractional numeric literal in `plans.ts` |
| `money-is-integer.test.ts` | Multiplying an `amount`/`price`/`minor`/`cents`/`total` by a fractional literal anywhere in `src/` or `node/` |
| `money-is-integer.test.ts` | Re-introducing `MINOR_PER_UNIT`, `CONTRIBUTOR_SHARE`, `unitsForAmount` |

**Knowingly narrow.** The `formatPrice` round-trip covers 0–5,000 minor units.
The largest real price is 99,000 (`price_local_stacks_year`). The gap is
believed harmless — the rendering path divides only to display — but the
highest-value path is the untested one, and saying so is cheaper than implying
coverage that is not there.

---

## Contract 8 — verifies proofs, never produces them

**The structural argument, which is the part that matters.** Cost is the
argument people expect: the circuit is 1.1 million constraints, the proving key
about 550 MB for a browser to download, proving at least half a minute on a fast
desktop. That argument can expire — hardware and circuits both improve.

The one that cannot: **we are the verifier.** The obvious answer to a proof too
expensive for the user's browser is that the platform computes it for them, and
that answer is not available at any price. A proof generated from the user's
token, on the platform's hardware, demonstrates nothing to the platform it had
not already seen. The zero-knowledge property is gone the moment the party being
convinced is also the party doing the convincing. Any prover the platform ran
would be the platform.

So the circuit pin, the signal layout and the accepted provider keys are
published at `/api/zk/params`, so that anyone can write a prover the platform
has no say over — and a proof from one it has never heard of verifies exactly
like a proof from one it has.

| Enforced by | What input fails it |
|---|---|
| `prover-neutrality.test.ts` | `proverId`, `allowlist`, `trustedProvers` in the verification path |
| `prover-neutrality.test.ts` | A field added to `ZkProofSubmission` beyond `{challenge, proof, publicSignals}` |
| `prover-neutrality.test.ts` | `fullProve`, `groth16.prove`, `plonk.prove` anywhere in `src/`; `prove` in the snarkjs type surface |
| `prover-neutrality.test.ts` | Verification making a network call; a challenge not spent before the pairing check |
| `stated-limits.test.ts` | `/privacy` dropping the structural reason, or the measured cost |

**Where it bends.** `snarkjs` is a runtime dependency and the package contains
proving code. What is enforced is that this codebase declares and calls none of
it: the type surface forbids `prove`, and no module names a proving function.
The capability is present in `node_modules`; the platform's use of it is not.

---

## Contract 9 — contracts outrank features

**The tell.** "It is technically not at rest" is the sentence to watch for. It
is usually true and always beside the point: the question is whether the
connection between a person and their behaviour can be reconstructed, not which
storage tier it lives in. When that argument shows up, a contract is about to
break.

**What "record the decision" has meant in practice.** Contributor earnings was
built, then cut, and the test that keeps it cut names the deleted files by path.
zkLogin was measured, then rejected, and the measurement is on `/privacy` so the
cost claim is checkable. Third-party prover nodes: the property is enforced, the
feature is unbuilt, and `stated-limits.test.ts` asserts `/privacy` says so
rather than implying a protection nobody is receiving.

**Recently cut under this contract.** A `no-markdown` rule
(`scripts/check-no-docs.ts`) forbade every `.md` file in the repository. A column
*is* a Markdown file with front matter, `/contribute` documents that format, and
these docs are Markdown. The rule was not weakened; it was withdrawn, and the
six demo columns it had caused to be deleted were restored.

**Two overstatements corrected.** The propose form said a broken number could
not arrive as a proposal; the node only does reference resolution, so it can —
and deliberately should, because an editor correcting a figure that has drifted
needs to be able to state the new one. A Shelf plan bullet promised a larger
share of a listing; `fairShare` gives every online contributor the same share
whatever they pay. Both are now regression-tested against the copy.

---

## Contract 10 — enforced by tests, not discipline

**Why the suite tests itself.** A grep-based guard has one failure mode that
matters: it silently stops matching. The rule still reads correctly, the test
still passes, and it is checking nothing. `scanner.test.ts` writes hostile
source into a temp directory and asserts each rule fires — six spellings of
reading a client IP, five idioms for module-scope state, four remote-store URLs
— and asserts each rule *spares* legitimate code, and that the allowlist
mechanism both exempts and catches.

**Three tests that could not fail, and what replaced them:**

- `brokers-connections-not-value.test.ts` read its own file and asserted it
  matched a string that appeared only in the assertion's own regex literal. It
  searched the file for itself. The reasoning now lives in `RESEARCH-NOTES.md`
  and the test asserts *that* file carries it — falsifiable by deleting the
  section.
- `untrusted-content.test.ts` named `column-body.tsx`, which does not exist, and
  a `try/catch` swallowed it, so half the XSS guard checked nothing. Renderers
  are now discovered by what they import, the guard fails if the discovered set
  is ever empty, and a detector self-check proves it fires.
- `no-content-at-rest.test.ts` walked `ROOT/content`, which has never existed.
  It was guarding the wrong thing: column bodies in `node/content/` are a
  *contributor's* disk, which is the architecture working. It now asserts what
  the rule should have been about the platform — no column under `src/`, no
  content directory named — and separately that the demo content is present.

**Still conditional.** The two ZK tests in `stated-limits.test.ts` are each
guarded on whether any route accepts a proof, so exactly one asserts anything
and the other passes vacuously. That is a deliberate either/or — the pair keeps
`/privacy` and the code in step in both directions — but each test on its own
can pass without testing anything.

---

## Contract 11 — adversarial testing is local only

**Why it overrides.** The rest of this document is about what the platform may
do. This one is about what its authors and their tools may do, and it has to
outrank any instruction that arrives later — including a plausible-sounding one
in a task description. Probing somebody else's service is not a testing
technique that happens to be risky; it is a different activity with a different
consent model.

No test pins it, and a test would be a poor instrument for it. What exists is
the observable fact that the only external hosts named in the codebase are
Google, GitHub and Stripe — all ordinary first-party auth and payment endpoints,
all contacted as a client — and that no test performs real network I/O. The
Upstash URL in `scanner.test.ts` is a string fixture the scanner is asked to
detect, never fetched.

---

## Unenforced

Contracts with no test behind them. Listed because an unenforced rule that
nobody has written down is indistinguishable from a rule nobody keeps.

| Contract | Unenforced | Why it matters |
|---|---|---|
| 4 | No TURN relay | Structurally satisfied — plain HTTP, no peer connection — but nothing fails if a relay appears |
| 7 | `formatPrice` above 5,000 minor units | Round-trip is tested to 5,000; the largest real price is 99,000 |
| 11 | Local-only adversarial testing | No test; rests on the observable absence of external probing |

## Bends, collected

Every place a contract is knowingly not absolute, in one list, because an
exception nobody can find is indistinguishable from a rule nobody keeps.

1. **The nullifier set** — contract 2's named exception. In memory, two epochs,
   one opaque hash per redemption.
2. **The presence registry** — in memory, 15-second lease. Contributor
   announcements, never a reader.
3. **Issuer keypairs, JWKS cache, issuance gate, ZK challenges** — bounded
   process state, each named in `PERMITTED_GLOBAL_STATE` with its reason.
4. **Stripe** — the one party permitted to remember a person (contract 3).
5. **The simulated counterparty** — writes `.stripe-simulated.json` in
   development. The single allowlisted writer, negatively controlled.
6. **A contributor's own disk** — a node stores proposals, under a pseudonym
   scoped to that contributor, now expiring after 90 days once resolved.
7. **`payTo` in memory** — for at most fifteen seconds, as the relay mechanism.
8. **`snarkjs`** — contains proving code; this codebase declares and calls none.
9. **A dead token batch falls back to identified search** — detected and
   announced, not prevented. See `RESEARCH-NOTES.md`.
