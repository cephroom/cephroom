# Architectural contracts

Two constraints govern this platform. They are not goals or preferences. When
a feature and a contract conflict, the contract wins and the feature is cut,
and the cut is recorded at the bottom of this document.

Both are enforced by tests in `tests/contracts/`, not by discipline. If you
can make those tests pass while violating the spirit of a contract, the test
is wrong — fix the test.

---

## Contract 1 — No user data at rest

**The platform persists nothing about users.** No user table, no profile rows,
no email addresses, no session store, no local mirror of anyone's
subscription.

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

### Everything else is also "at rest"

Logs, analytics, error reports and caches all count. The audit:

| Surface | Decision |
| --- | --- |
| HTTP access logs | Disabled. No request logging that retains identity — no IP, no user agent, no `sub`. |
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
- The node opens a WebSocket to the platform and **announces** what it serves:
  ids, titles, tags, and the address readers should fetch from.
- The platform holds that announcement **in memory, keyed by the live
  connection**. It is never written to disk.
- A reader's browser fetches column bytes **directly from the node**. The
  platform supplies an address and nothing else. Bytes never transit the
  platform, so there is nothing for it to cache or proxy-persist.
- When the contributor stops their node, the socket closes and the
  announcement is gone. The content vanishes from the site **because the
  registry entry was the connection**, not because a cleanup job ran.

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

### Discovery without an index

There is no index. There is no crawl. There is no "all columns ever
published" table, because such a table is exactly the thing Contract 2 exists
to prevent.

Discovery is **presence**: the platform can only tell you about work that is
being served right now, by a node currently connected. Search is a scan over
live announcements. A column that nobody is serving is not findable, and that
is the correct behaviour rather than a gap.

The consequence for the product is severe and worth stating plainly: **Bindery
has no archive.** A reader cannot cite a column and expect it to be there next
year. The honest framing is that Bindery is a live reading surface over work
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
| Server-stored column bodies, revisions and proposals | 2 | Shared content. All three now live in the contributor's node. |
| Persisted check runs and check history | 2 | A check result is a derived record of content the platform is not allowed to hold. Replaced by verification in the reader's browser at read time, which is strictly better: every read is a fresh check, and a stale green badge becomes impossible. |
| The archive, and search over it | 2 | Discovery is presence. There is no index of what has ever existed. |
| Server-side drafts in the studio | 2 | Authoring moved into the node. |

### One thing the cuts improved

Persisted check runs meant a column could display a green badge from a run
three weeks ago. Verifying in the reader's browser at read time makes that
impossible: the badge is the result of a check performed a few hundred
milliseconds ago against the dataset as it is right now. The contract forced a
design that is more honest than the one it replaced.
