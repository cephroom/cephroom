# Architectural contracts

Three constraints govern this platform. They are not goals or preferences.
When a feature and a contract conflict, the contract wins and the feature is
cut, and the cut is recorded at the bottom of this document.

All three are enforced by tests in `tests/contracts/`, not by discipline. If
you can make those tests pass while violating the spirit of a contract, the
test is wrong — fix the test. A suite that would still pass after a user
table appeared is not enforcing anything.

---

## Contract 0 — This is a GitHub for science

The product is a GitHub for science, and that is the boundary of what it may
become. Not a blog platform, not a paywalled magazine, not a social network
that hosts papers.

GitHub's value was never storage. It was that every change is attributable,
diffable, reviewable, and re-tested, and that provenance — who changed what,
against which base — is inescapable. The scientific translation is the spine
of this product:

- a number in prose is a **query against a versioned dataset**, not a literal;
- a number that depends on **how it was computed** says which analysis
  produced it, and will not resolve without one;
- a **reader re-runs** every query on the way in, so a stale value says so;
- a **proposal is a diff** the author reviews, delivered to their own machine;
- everything carries its **provenance** — dataset release, evidence count,
  the query itself.

The test for any feature: does it strengthen that loop? A change that would be
equally at home on any generic content site, or that would make this
indistinguishable from a publishing SaaS, is the wrong change no matter what
metric it improves. Patterns that assume a persistent social graph — profiles,
followers, stars, contribution calendars, view counts, trending — are doubly
forbidden: they dilute the thesis *and* they require the storage Contracts 1
and 2 prohibit. See docs/COMPETITIVE-NOTES.md for the GitHub/Zenodo analysis
that grounds this.

This contract is enforced structurally rather than by a single assertion: the
storage tests below make the social-graph features unbuildable (they all need
a user table), and `tests/contracts/thesis.test.ts` guards the specific
temptations by name.

### The platform brokers connections, never value

**Money between a reader and a contributor does not pass through here, and the
platform never funds a payment to a contributor.** A subscription buys a key of
a given tier. The tier is a permission — what the holder may reach — not a
balance, not an allowance, and not consumed by use. It expires when the key
does, and that is the whole of the model.

A contributor may announce a string saying where they can be paid. The platform
displays it verbatim. That is the entire extent of its involvement.

None of the following may be built:

| | |
| --- | --- |
| Calculating an amount owed | makes the platform a party to the transaction |
| Holding funds, escrow, or a pending balance | makes it a custodian |
| Routing or facilitating a transfer | makes it a payments business |
| Recording that a payment happened | an activity record about two people |
| Displaying who has earned what | a public ledger of private dealings |
| Recommended or suggested prices | price-setting in a market it runs |
| **Bonuses, growth incentives, or subsidies for popular contributors** | platform-funded payouts, which is the hole this closes |

The last row is the one that will be argued for later, because it is the
obvious growth lever and it will look harmless. It is not.

**Why this is a contract and not a preference.** An earlier design had the
platform take a subscription, split it, and pay contributors from the reserved
part against signed usage records. It was carefully built: dual-signed receipt
chains, write-before-pay ordering, per-grant caps, bounded spent counters. All
of it existed to defend against one attack — **two colluding parties can sign a
transfer that never happened**, and the platform cannot tell, because it does
not observe the data layer and that boundary does not move.

That attack cannot be prevented. The argument is short: a transcript of a real
transfer is computable by the serving party alone, so anything the receiving
party could contribute after a real transfer, they can contribute without one.
The two worlds are identical to any observer who sees only what the two parties
choose to send. No cryptography changes this — not zero-knowledge proofs, which
prove knowledge the colluder legitimately has, and not the prover nodes.

The defences were therefore economic rather than absolute: make it
loss-making, bound the damage. That works, and it is a permanent tax on
attention — every future change has to be checked against it, and the one
remaining route to a real gain (a payment reversed after its units were paid
out) could only be bounded, never closed.

**Removing the pool removes the attack.** Two parties signing a fabricated
transfer are now dividing their own money. There is no platform pool to drain,
nothing is ever paid out by us, and total paid cannot exceed total received
because total paid is zero. A structural fix beats a defended one, and the
metering machinery that defended it is gone.

---

---

## Contract 1 — No person-linkable data at rest

> **Restated, 2026-09-12.** This contract used to read "no user data at rest",
> and that wording was exactly true until anonymous access tokens arrived. A
> blind signature scheme cannot prevent a token being spent twice unless
> something remembers that it has been spent, so there is now a set of opaque
> spent-token markers in memory. It holds no person and can be linked to none —
> but "the platform stores nothing" is no longer literally true, and the
> honest response to that is to change the sentence rather than to keep saying
> it and rely on a footnote. The exception is named and bounded below, and
> `tests/contracts/nullifier-shape.test.ts` holds it to its bounds.

**The platform persists nothing that can be linked to a person.** No user
table, no profile rows, no email addresses, no display names, no avatars, no
preferences, no activity record, no session store, no local mirror of anyone's
subscription.

Identity is proven at sign-in and immediately forgotten. A signed key carries
everything the platform is allowed to know about who you are, and
authorization is signature verification, never a lookup. A display name is
not an exception: the key may carry the name you chose at your provider so a
page can greet you, and a node may announce a self-declared name while it is
live, but neither is ever written down by the platform.

### The auth flow

1. A reader signs in with Google. This proves identity and nothing else.
2. **Nothing is written anywhere as a result.** No row is created, no session
   is stored, no file is touched.
3. The platform mints a **key**: an Ed25519-signed capability token carrying
   subject, tier, scope and expiry.
4. Every subsequent authorization decision is a signature verification. There
   is no lookup, because there is nothing to look up.

### The key

```
header   { alg: "EdDSA", typ: "JWT" }
payload  {
  sub   pseudonymous subject — HMAC(provider + provider account id)
  tier  "reader" | "member" | "lab"
  scp   ["read:public", "read:member", "write:propose", ...]
  cus   Stripe customer id, or absent
  iat   issued at
  exp   expiry
}
```

`sub` is an HMAC of the provider's account id under a server secret. It is
stable across sign-ins, which is what makes attribution possible, and it is
not reversible to an email address by anyone holding the token or a database
dump — there being no database dump.

`cus` is the one piece of linkage the design needs. It lives in the token, in
the reader's browser, and is what lets the platform ask Stripe who this is at
renewal time without keeping a table that answers the same question.

Signing is **asymmetric on purpose**. A contributor's node has to be able to
verify a reader's key before serving member-only content, and it must be able
to do that with a public key alone. A shared secret would mean every node
could mint keys.

### Subscription state

Stripe is the only stateful party. The platform **does not mirror Stripe's
records** — not in a table, not in a cache, not in a file.

Tier is derived live: at key-issue and at every renewal the platform calls
Stripe, reads the customer's subscriptions, and stamps the resulting tier into
the key. Between renewals the key is the answer. There is no local
`subscription` row to drift out of sync, because there is no local
subscription row.

The consequence is a Stripe API call per renewal per active reader. That cost
is accepted. It is the price of not holding the data.

### Revocation, honestly

**A signed token cannot be revoked without a blocklist, and a blocklist is
state.** So there is no revocation. This is the sharpest tradeoff in the
design and it is not papered over:

| | |
| --- | --- |
| Access key lifetime | **15 minutes** |
| Refresh key lifetime | **7 days** |
| Worst-case window after a downgrade or cancellation | **15 minutes** |
| Worst-case window for a stolen access key | **15 minutes** |
| Worst-case window for a stolen refresh key | **7 days** |

What this buys: no session table, no per-request database read, and a platform
that cannot leak a list of its subscribers because it does not have one.

What it costs: a reader who cancels keeps member access for up to fifteen
minutes. A stolen refresh key cannot be invalidated — the holder has up to
seven days, and the only remedy is rotating the server signing key, which
signs everyone out at once. That is a real, unmitigated weakness and it is
stated here rather than hidden behind "tokens are short-lived".

Refresh tokens are **not rotated with reuse detection**, because detection
requires remembering which tokens have been seen, which is state. A shorter
refresh lifetime is the only lever available and 7 days is where it is set.

The **serve key** a contributor pastes into their node (`NODE_KEY`) is the
longest-lived credential, at 30 days, because a node runs unattended and a
7-day key would take it offline weekly. It shares the same no-revocation
model, so its lifetime is its exposure — but the blast radius is narrow: a
leaked serve key lets someone announce under that subject (list content in
the namespace), and nothing else. It grants no read access to any reader's
data and cannot touch billing. This is enforced, not asserted: the serve key
carries its own audience (`cephroom:serve`) that the reader-session
verifier (`verifyAccessKey`, used by the platform and, through the platform's
public key, by every node) refuses, so no path can accept it as a read
credential — see `tests/contracts/key-forgery.test.ts`. It is issued on demand
from the account page, never stored, and a contributor reveals a fresh one if
the old one leaks.

(An earlier build minted the serve key on the *access* audience with full tier
scopes, which quietly made it a 30-day read credential — a direct violation of
this paragraph, caught by a self-audit and closed by giving it its own
audience.)

### Anonymous access tokens, and the state they require

Signing in yields a pseudonymous subject, and that subject rides on requests.
Nothing is written down and the tests say nothing is written down — but the
platform is *capable* of associating one person's reading with their
subscription, and declines to. **A promise enforced by tests is weaker than a
property enforced by arithmetic**, so paying and reading are severed.

The mechanism is **Privacy Pass** — RFC 9576 (architecture), RFC 9577 (token
structure), RFC 9578 (issuance) — using **token type 0x0002, publicly
verifiable blind RSA (RFC 9474)**. Public verifiability is not optional here
and is chosen for the same reason the capability keys are Ed25519 rather than
an HMAC: a contributor's node must be able to check what a reader presents with
a public key alone. The privately verifiable type would put the platform back
in the request path, which Contract 2 forbids.

1. A subscriber's browser blinds a batch of tokens with random factors that
   never leave the machine, and asks for them to be signed.
2. The platform checks entitlement live against Stripe — this is the one moment
   it knows who is asking — and signs values it cannot read.
3. Later the browser unblinds one and redeems it **with no cookie attached**.
   The platform verifies the signature and cannot tell which issuance produced
   it, because the only thing connecting them is a blinding factor it never
   had.
4. It mints a key carrying a tier and **no subject**, because none exists.

A token has no payload, so the tier is *which key signed it*: one keypair per
(tier, epoch). The cost is that a redemption reveals its tier, and nothing
about who.

An anonymous key carries read scopes only. `write:propose` is withheld
deliberately: a proposal lands on an author's disk and has to be from somebody.
If you want to argue with an author you sign your name; if you want to read,
you do not.

#### The nullifier set — the bounded exception

This is the state, named rather than argued away:

| | |
| --- | --- |
| What an entry is | one opaque 32-byte hash of a token nonce |
| What else an entry holds | **nothing** — no timestamp finer than the epoch, no address, no user agent, no tier, no count |
| Where it lives | RAM, dies with the process |
| How long | epoch-bucketed; an epoch is dropped whole when its signing key retires |
| Key rotation | hourly, two live epochs |
| Therefore | the set's size is a function of the last two hours of traffic, not of traffic ever |

It is a `Map<number, Set<Nullifier>>` and not a `Map<..., something>` on
purpose. A `Set` can only remember that a thing happened, which is all
double-spend prevention needs; the moment it can carry a value, somebody adds a
timestamp "for debugging" and an opaque set becomes a log. The contract test
asserts the data structure, not just the behaviour.

The residual is honest: an operator could watch redemptions arrive and count
them. They could not tell whose they were, nor that two came from the same
subscriber, which is the property being bought.

#### What this does not achieve

Stated here and, more importantly, on `/privacy` where readers see it, because
overclaiming privacy is worse than claiming none:

- **Google knows** the reader signed in. That redirect is on Google's servers.
- **Stripe knows** who paid. Taking money requires real identity.
- **The contributor sees a network address.** A direct fetch from their machine
  means an IP at the other end. A token hides *who*, never *where*.
- **Page requests still carry the session cookie.** Tokens cover what a browser
  fetches from a node. The platform page around it is still requested with a
  same-site cookie, so the platform could today see which column *pages* were
  opened. Narrowing that is outstanding work and is described as outstanding.

#### zkLogin, and why it is not here

A second layer was specified: a zero-knowledge proof that the client holds a
valid Google-signed JWT, so the platform never sees the Google identity at all.
It is not built, and the reason is measured rather than asserted.

zkLogin's circuit is **1.1 million R1CS constraints**, 80% of which is verifying
Google's RS256 signature and therefore irreducible. Proving it in Chrome with
snarkjs was benchmarked here at four circuit sizes on a 16-core, 16 GB machine:
the proving key is **478–513 bytes per constraint, linear over a 30× range**, so
1.1M constraints needs **~550 MB of proving key downloaded into the browser**,
and proving costs **at least 31 seconds** by a straight-line extrapolation that
ignores both the Θ(n log n) factor and a multi-gigabyte working set. zkLogin's
own authors write that proving ~1M-constraint Groth16 "can lead to crashes or
long delays on a browser", and Sui's production system therefore proves on a
backend service.

A proving service is a party that sees the JWT. For Sui that is acceptable
because the verifier is a blockchain and the prover is someone else. Here the
platform **is** the verifier, so any prover we operate is us, and the separation
the layer exists to create does not exist. Shipping a proof that is not a proof,
or a circuit without a real ceremony, would be the overclaiming that `/privacy`
argues against.

**A third route exists and is now specified.** The platform already depends on
machines it does not run — a contributor serves their own columns — so proving
becomes another node type. A user picks a prover, or runs one, and the platform
verifies without ever seeing the JWT. The protocol, the verifier, the challenge
binding and the replay spend are built and tested; no circuit artefacts ship and
no prover can yet prove. The tradeoff is that a prover sees the token, which
moves trust rather than removing it — acceptable only because the platform
cannot tell provers apart and never operates one. See docs/PROVER-PROTOCOL.md,
and `tests/contracts/prover-neutrality.test.ts`, which fails if a prover
allowlist, a preference, or a proving call ever appears.

What was also done, smaller and honest: the platform **stopped requesting
the `email` scope** from Google. It never used the address, but asking for it
meant receiving it. Not asking removes it from the process entirely. This
narrows what arrives beside the identity; it does not sever the identity, and
nothing in the product describes it as doing so. Full reasoning and the
benchmark table are in docs/RESEARCH-NOTES.md.

### Everything else is also "at rest"

Logs, analytics, error reports and caches all count. The audit:

| Surface | Decision |
| --- | --- |
| HTTP access logs | Disabled in `next.config.ts` (`logging.incomingRequests: false`). No request logging that retains identity — no IP, no user agent, no `sub`. |
| Server Function logs | Disabled (`logging.serverFunctions: false`). Next logs each call *with its arguments*; nothing passes a subject into a server action today, but a claim that depends on nobody ever doing so is not much of a claim. |
| Application logs | Permitted, but must not include `sub`, `cus`, email, IP, or token material. Enforced by test. |
| Error reporting | No third-party error reporter is configured. If one is added it must have PII scrubbing on and IP capture off. |
| Analytics | None. No page-view collection, first- or third-party. |
| Server caches | The platform keeps no response cache keyed by identity. |
| Stripe | Holds email, name and payment details. This is deliberate: Stripe is the stateful party, and it has to be, because someone must hold a payment relationship. |

The platform never reads the client IP from a socket. The one place an address
is needed — a contributor's node advertising where to reach it — the address is
supplied by the node in its own announcement rather than inferred from the
connection.

---

## Contract 2 — Data stays local, always

**The platform never stores shared content.** A contributor's work lives on
their machine and is served from their machine for as long as they choose to
serve it.

### The shape

- A contributor runs a **node**: a small local process that reads their
  columns and datasets from their own filesystem and serves them over HTTP.
- The node **announces** what it serves over plain HTTP: ids, titles, tags,
  and the address readers should fetch from. It then heartbeats to keep a
  short lease alive.
- The platform holds that announcement **in memory, keyed by the lease**. It
  is never written to disk.
- A reader's browser fetches column bytes **directly from the node**. The
  platform supplies an address and nothing else. Bytes never transit the
  platform, so there is nothing for it to cache or proxy-persist.
- Stopping the node withdraws it. On a clean shutdown that is immediate; on a
  hard kill the lease simply lapses. Either way the content vanishes **because
  the lease was what made it visible**, not because a cleanup job ran —
  expiry is lazy, filtered on read, with no sweeper anywhere.

**The honest bound.** A lease lasts 15 seconds. A node killed without warning
stays listed for up to that long, and a reader who clicks through in that
window gets an error from the unreachable node rather than a cached copy —
which is the correct failure, since there is no cached copy to serve. Measured
it: still listed immediately after `kill -9`, gone 17 seconds later.

### When a contributor is offline

They are absent. Not greyed out, not a tombstone with a title — absent from
discovery entirely, because the platform does not know the title.

A reader following a direct link to an offline node gets a page built from the
id in the URL and nothing else: *this contributor is offline, and nothing
about their work is stored here*. That page is deliberately uninformative. A
helpful "Three empty cells, by Marcus Oyelaran — currently offline" would
require the platform to have kept the title, which is the thing the contract
forbids.

### Does signaling metadata count as user data?

**Yes**, and it is handled as such:

- Connection records are never written. The registry is a `Map` that dies with
  the process.
- IP addresses are never read from the socket. The node states its own
  reachable address in its announcement; the platform does not inspect
  `remoteAddress` or `x-forwarded-for`.
- A node's announcement carries its **key's `sub`**, not an email — the same
  pseudonymous subject used everywhere else.
- Nothing about a past connection survives it. There is no "last seen".

The residual exposure is honest: while a node is connected, the platform
holds, in RAM, the association between a pseudonymous subject and a network
address. A sufficiently motivated operator of the platform could observe that.
The mitigation is that it is never persisted, never logged, and gone the
instant the socket closes.

### Signaling is authenticated

Contract 2 promises a contributor's work stays available *while they serve
it*. That promise is only as strong as the platform's refusal to let anyone
else end their lease.

Every call to `/api/signal` — announce, heartbeat, withdraw — must carry a
valid capability key, and the subject is taken from that key, never from the
request body or a URL parameter. A heartbeat or withdrawal touches only a
connection owned by the caller's own subject.

This closes a takedown found by attacking the local server: the endpoints
previously accepted a `connectionId` with no proof of ownership, and that id
was serialized into the `/read` flight payload, so any visitor could read it
back and knock any contributor offline with one unauthenticated request. The
same gap let anyone announce anonymously — flooding the registry, or claiming
another contributor's subject. Regression tests are in
`tests/contracts/signal-auth.test.ts`.

Serving remains free: any signed-in reader may announce, whatever their tier.
The requirement is attribution, not payment — an announcement must be
traceable to a subject, so that the registry cannot be written to anonymously.

### Discovery without an index

There is no index. There is no crawl. There is no "all columns ever
published" table, because such a table is exactly the thing Contract 2 exists
to prevent.

Discovery is **presence**: the platform can only tell you about work that is
being served right now, by a node currently connected. Search is a scan over
live announcements. A column that nobody is serving is not findable, and that
is the correct behaviour rather than a gap.

The consequence for the product is severe and worth stating plainly: **Cephroom
has no archive.** A reader cannot cite a column and expect it to be there next
year. The honest framing is that Cephroom is a live reading surface over work
its authors are actively standing behind — if nobody will serve it, nobody is
standing behind it.

---

## Where the contracts bend, and why

Every bend is listed. If you add one, add it here.

### 1. The in-memory presence registry

**Bend:** Contract 1 counts caches as data at rest, and the registry is a
cache of who is online and what they serve.

**Why:** Contract 2's guarantee — content disappears the instant the process
stops — is only meaningful if something tracked that the process was running.
Without a live registry there is no discovery at all, and the platform has no
function.

**Bounded by:** RAM only, no disk, no logging. Keyed by connection. Holds a
pseudonymous `sub`, a self-declared address, and a manifest of ids and titles.
Dies with the socket, and with the process.

### 2. Stripe holds real user data

**Bend:** Stripe stores email, name, and payment details.

**Why:** Someone must hold a payment relationship, and it cannot be nobody.
The contract's own wording anticipates this: *"Stripe is the only stateful
party."*

**Bounded by:** The platform never copies any of it back. Not a customer
email, not a subscription row, not an invoice. The only Stripe identifier the
platform handles is the customer id, and it handles it by putting it in a
token and forgetting it.

**The cost nobody anticipates: the metadata key is stored data we do not
own.** Because the subject-to-customer map lives in Stripe's customer
metadata rather than in a table here, the *name of that key* is a value
already written into records the platform cannot rewrite in bulk. It is named
after the platform, so renaming the platform changes the constant and not the
data. `findCustomerBySubject` then misses, and a returning subscriber is
treated as new: a second customer is created beside their live subscription
and they drop to Reader while still being billed. Silent, and expensive.

This happened. The platform was called `receptorome` before it was called
`cephroom`. The fix is not to freeze the key but to treat it as append-only
history: `SUBJECT_METADATA_KEYS` in `src/lib/stripe/types.ts` lists every name
the platform has ever used, newest first, the lookup tries each in turn, and a
customer found under an old one is migrated forward on the spot — so the extra
search is paid once per customer, ever. Adding a name is free. Removing one
orphans everybody who has not signed in since. `tests/contracts/rename-continuity.test.ts`
holds the line.

A third-party store holding *our* schema is a general hazard, not a Stripe
quirk. Anything else we ever ask an outside party to remember for us inherits
the same rule.

### 3. The simulated Stripe, in development only

**Bend:** `simulated-counterparties/stripe/` writes a JSON file containing
customers and subscriptions.

**Why:** Live Stripe keys need KYC and a bank account. Without a stand-in, the
billing path cannot be exercised at all. The file is the *counterparty's*
store, standing in for Stripe's own database — it is not the platform storing
user data, it is a simulation of the party that is allowed to.

**Bounded by:** Lives under `simulated-counterparties/`, so the boundary is
structural rather than a comment. Never loaded when `STRIPE_SECRET_KEY` is
set. Never imported by anything under `src/`aside from the gateway switch. The
contract test allowlists exactly this path and fails if the allowlist grows.

### 4. The platform must run as a single long-lived instance

**Bend:** Not a contract violation so much as a constraint the contracts
impose, recorded here because it is easy to break by accident.

**Why:** The presence registry is per-process. Spread the platform across
serverless invocations and each one has its own registry, so a node announces
to instance A and a reader asks instance B, which has never heard of it. The
obvious fix — a shared Redis or a database table — is exactly the durable
store both contracts forbid.

**Bounded by:** Deploy as one persistent Node process. If that ever has to
change, the replacement has to be a shared *volatile* medium with no
persistence and no logging, and it goes in this list.

### 5. The node writes to the contributor's disk

**Bend:** A node reads and writes files.

**Why:** It is the contributor's own machine. That is the entire point of
Contract 2 — their data lives with them.

**Bounded by:** `node/` is not the platform. The contract tests scope
themselves to `src/` and the deployed surface.

**Hardened against the write channel it exposes.** A proposal is the one thing
a stranger can cause a node to write, so it is a disk-fill vector. Attacking
the local node confirmed an unbounded one: a 3 MB proposal body was accepted
and written. The node now (a) caps the request body while reading it, so it
never buffers more than ~640 KB before rejecting with 413; (b) bounds each
field — 512 KB body, 300-char title, 4 KB rationale — with 400; and (c) limits
one subject to 20 open proposals per column with 429, so nobody can flood the
count. Verified all three against the running node, and the count gate is
covered by `tests/node/proposal-store.test.ts`. A resolved proposal frees the
subject's budget, so an author working through their queue is not punished.

---

## What was cut

These features were built and then removed because they cannot coexist with
the contracts. They are recorded so nobody rebuilds them by accident.

| Cut | Contract | Why it cannot be kept |
| --- | --- | --- |
| `user`, `account`, `session`, `verificationToken` tables | 1 | Definitionally user data at rest. |
| Email and password sign-in | 1 | Requires storing a password hash against an identity. Google and GitHub prove identity without the platform holding a credential. |
| Local `subscription` mirror | 1 | The contract names it explicitly: the platform must not mirror Stripe's records. |
| Stripe webhook receiver and `stripe_event` idempotency table | 1 | Both existed to keep the local mirror current. With tier derived live from Stripe at renewal, there is nothing for a webhook to update, and idempotency needs a table of events already seen. |
| Saved columns / bookmarks | 1 | A per-user list is a per-user row. |
| Author profiles with bio and handle | 1 | Profile rows. Attribution now carries the pseudonymous `sub` and whatever display name the node chooses to announce while it is online. |
| Server-stored column bodies and revisions | 2 | Shared content. Both now live in the contributor's node. |
| Persisted check runs and check history | 2 | A check result is a derived record of content the platform is not allowed to hold. Replaced by verification in the reader's browser at read time, which is strictly better: every read is a fresh check, and a stale green badge becomes impossible. |
| The archive, and search over it | 2 | Discovery is presence. There is no index of what has ever existed. |
| Server-side drafts in the studio | 2 | Authoring moved into the node. |

## What came back, rebuilt to fit

Proposals were cut and then reinstated in a form the contracts allow. A
reader's browser posts a proposed edit **straight to the author's node**,
which verifies the reader's key carries `write:propose`, re-parses the
submission, refuses anything whose claims do not resolve, and writes it to the
author's own disk next to the column. The platform is not a party to any of
it - it never holds the draft, never sees the diff, and could not moderate it
if it wanted to.

Two consequences fall out, both correct rather than unfortunate:

- A proposal can only be made while the author is online. There is no queue
  here to leave it in, because a queue would be the platform holding someone's
  edit.
- Proposals are readable only from the author's node, so they disappear with
  everything else when they stop serving.

Building it surfaced a real bug worth recording: the node was serving readers
the *rendered* prose, with claim definition blocks already stripped. Editing
that and posting it back produced a body full of `{{claim:...}}` references
with nothing defining them, and the node's own validation rejected it. A
proposal is a diff of the source the way a pull request is a diff of the file,
so the node now serves the Markdown source to anyone entitled to the whole
column. The claim checker caught the round trip being lossy, which is more or
less its job.

### One thing the cuts improved

Persisted check runs meant a column could display a green badge from a run
three weeks ago. Verifying in the reader's browser at read time makes that
impossible: the badge is the result of a check performed a few hundred
milliseconds ago against the dataset as it is right now. The contract forced a
design that is more honest than the one it replaced.
