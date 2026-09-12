# Cephroom

**Science writing with a build step.**

A subscription publication for pharmacology and neuroscience where every
number in a column is a live query against a dataset, re-checked in your
browser on the way in.

It is also built to two constraints that decide nearly everything else about
it: **the platform stores nothing about you, and stores nothing anyone
writes.** Both are specified in [docs/CONTRACTS.md](docs/CONTRACTS.md) and
enforced by tests in [`tests/contracts/`](tests/contracts).

---

## The editorial problem

A review article is a snapshot. The databases underneath it are not.

ChEMBL ships a release every few months. A value that was a median of
fourteen measurements in 2021 is a median of thirty-one now, and sometimes the
median moves. The prose does not. Nobody re-reads a four-year-old review
against the current data, so the literature slowly accumulates sentences that
were true once.

Software had the same problem and did not solve it by writing more carefully.
It solved it with continuous integration. Cephroom does the same for numbers in
prose — an author never types a measured value, they write the query that
produces it:

````markdown
Haloperidol binds the human D2 receptor with a median Ki of
{{claim:hal-d2}}, pooled across {{claim:hal-d2-docs}} independent
publications.

```claim hal-d2
dataset: receptorome-ki
metric:  median_ki_nm
subject: DRD2
object:  haloperidol
value:   1.549 nM
tolerance: 10%
```
````

| Verdict | Meaning |
| --- | --- |
| **verified** | Within the tolerance the author set. |
| **drifted** | Both values exist and differ by more than the tolerance. The number on the page is current; the argument around it may not follow. |
| **broken** | The query did not resolve. A unit mismatch counts as broken, not drifted — `1.55 nM` against `1.55 µM` is a question nothing here may answer by guessing a conversion. |

The check runs **in the reader's browser, at read time**, against the dataset
as it is right now. That is a consequence of the second contract rather than a
design flourish, and it is better than what it replaced: a badge can no longer
be green because of a build that ran three weeks ago.

## The two contracts

### 1. No person-linkable data at rest

No user table, no profile rows, no session store, no local mirror of anyone's
subscription. There is no database at all — no schema, no migrations, and no
ORM in the dependency list.

(The contract used to say "no user data at rest" and that was exactly true
until anonymous access tokens arrived. Preventing a blind-signed token being
spent twice means remembering that it has been spent, so there is now a set of
opaque markers in RAM — no person on the end of any of them, an hour's
lifetime, and nothing in an entry beyond the fact that it exists. The sentence
was changed rather than kept and footnoted.)

You sign in with Google; nothing is written as a result. You receive an
Ed25519-signed **capability key** carrying a pseudonymous subject, a tier and
an expiry. Every authorization decision after that is a signature check.

That subject still rides along on requests, which means the platform is
*capable* of linking one person's reading to their subscription and merely
declines to. So it is severed by arithmetic instead: a subscriber's browser
gets a batch of **Privacy Pass** tokens (RFC 9578, publicly verifiable blind
RSA) that the platform signs without being able to see, and spends one — with
no cookie — for a key carrying a tier and no subject at all. What that does
*not* hide is on [/privacy](src/app/privacy/page.tsx), in the same plain
language, because overclaiming privacy is worse than claiming none.

- Tier is read from **Stripe, live**, at key-issue and every renewal. Stripe
  is the only stateful party, and it holds the subject-to-customer mapping in
  its own customer metadata so that we do not have to.
- **Keys cannot be revoked.** Revocation needs a blocklist and a blocklist is
  state. Access keys last 15 minutes, renewal keys 7 days. A cancellation
  takes effect within 15 minutes; a stolen renewal key cannot be invalidated
  short of rotating the signing key, which signs everybody out. That weakness
  is real and is written down rather than hidden behind "short-lived tokens".
- No password, because a password is something we would have to store.
- No request logging that retains identity, no analytics, no error reporter,
  and the platform never reads a client IP.

Signing is asymmetric because a contributor's node has to verify a reader's
key with a public key alone. A shared secret would let every node mint keys.

### 2. Data stays local

A contributor runs a **node** on their own machine. It reads their columns off
their own disk, announces ids, titles and an address to the platform, and
serves readers directly. Your browser fetches the bytes from theirs — the
platform is not in the request path, so it has nothing to cache or proxy.

The registry of who is online is a `Map` keyed by a lease, held in RAM and
never written. Expiry is lazy: a lapsed entry is filtered out on read rather
than swept, so work disappears because the lease was what made it visible, not
because a cleanup job noticed.

- **There is no archive.** You cannot cite a column and expect it next year.
  If nobody will serve it, nobody is standing behind it.
- **Discovery is presence.** Search reaches what is online, because an index
  of everything would be a copy of everything.
- An offline contributor is absent, and the page you land on cannot even name
  what used to be there — a helpful tombstone would mean the platform had kept
  the title.

Both contracts bend in four documented places, all listed in
[docs/CONTRACTS.md](docs/CONTRACTS.md), along with the features that were
built and then cut because they could not coexist with the rules.

## Running it

Two processes: the platform, and at least one contributor node.

```bash
npm install
cp .env.example .env.local
npm run keys:generate        # paste the three lines into .env.local
npm run dev                  # the platform, on :3000

# in another terminal
npm run node:serve           # a contributor's node, on :4600
```

Open <http://localhost:3000/read>. The node ships five columns and the
receptorome-ki dataset as example content; point it at your own directory and it
serves that instead.

Stop the node and reload — the work disappears from the site. That is the
second contract, observable.

### Authentication

Google and GitHub OAuth need credentials only the owner of a deployment can
create; set `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` and the GitHub pair to
enable them. Until then they render as disabled buttons naming the variables
they want.

With `AUTH_DEV_OAUTH=1` a local OAuth identity provider is mounted at
`/api/dev-oauth`. It is not a mock of our auth code — it is a mock of the
*identity provider*, the part that cannot be provisioned locally. The full
authorization-code flow with PKCE runs against it exactly as it will against
Google.

The OAuth flow is hand-rolled rather than delegated to a library. Auth
libraries are built around an adapter that persists users, accounts and
sessions; even configured not to, they carry the machinery. Implementing the
code flow directly is about 150 lines and makes "nothing is written" auditable
by reading it.

### Billing

The platform talks to a narrow `StripeGateway` port, and one environment
variable decides which implementation answers.

- **`STRIPE_SECRET_KEY` set** → the real Stripe SDK. Test key for test mode,
  live key for live. Going live is a key swap plus the `STRIPE_PRICE_*` ids.
- **unset** → a simulated counterparty under `simulated-counterparties/`,
  holding its own records the way Stripe would.

The simulated store is the one place in the repository that writes user data
to disk, and it is outside `src/` so that the boundary is structural rather
than a comment. The contract tests allowlist exactly that path and fail if the
allowlist grows.

`past_due` keeps access: Stripe retries a declined card over several days, and
cutting someone off at the first decline punishes an expired card rather than
a decision to leave. Cancellation is always at period end.

## Plans

| | Reader | Member | Lab |
| --- | --- | --- | --- |
| | Free | $9/mo · $90/yr | $29/mo · $290/yr |
| Open columns in full | ✓ | ✓ | ✓ |
| Member columns | preview | ✓ | ✓ |
| Claim inspector | | ✓ | ✓ |
| Lab columns | | | ✓ |

Access is enforced by the **node**, not by the platform — the node verifies
your key with the platform's public key and decides what to send. The platform
could not enforce it if it wanted to, because it is not in the request path.

Publishing costs nothing. Run a node and your work is discoverable for as long
as you serve it.

## The API

One API, both roles, and no API keys — an API key is a stable identifier issued
to a person, which is the thing Contract 1 refuses to hold. Authentication is
the same anonymous token scheme the site uses, and it works identically from a
shell.

```bash
npm run cli live "motor imagery"
npm run cli read s_localnode_marcus which-protocol-produced-that-number
npm run cli check ./my-columns/draft.md
```

`read` fetches the column from its author's node and checks every claim with
the same pure module the website runs, then exits non-zero if anything drifted
or broke — so it composes into CI, which is the premise of the platform applied
to itself. The platform is never in the content path: `/api/v1/read/...`
returns an address, not bytes.

Full walkthrough, both roles, in [docs/API.md](docs/API.md) — including the
half of rate limiting that the token scheme solves and the half it does not.

## Stack

- **Next.js 16** — App Router, Turbopack, React Server Components
- **TypeScript** strict, **Tailwind CSS v4**
- **jose** — Ed25519 capability keys
- **Stripe** — behind a port, with a simulated counterparty for development
- **Vitest** — the claim parser, the drift judge, the access policy, the
  differ, and both contracts
- No database, by contract

## Layout

```
src/
  app/                    routes
    api/auth/             hand-rolled OAuth, key minting and renewal
    api/signal/           the only thing nodes say to the platform
    .well-known/          the public key a node verifies readers with
  lib/
    access.ts             who may read what, pure, tested
    keys/tokens.ts        minting and verifying capability keys
    signaling/registry.ts presence, in RAM, keyed by a lease
    claims/syntax.ts      the claim grammar, pure
    claims/verdict.ts     the drift judge, pure
    diff.ts               line diff, pure
    stripe/               the gateway port and the live adapter
node/                     a contributor's node, and its example content
simulated-counterparties/ stands in for Stripe in development
tests/contracts/          the contracts, enforced
docs/CONTRACTS.md         the contracts, stated
```

## Tests

```bash
npm test
npm run build
```

95 tests. The contract suite is the interesting part: it fails if a schema
file appears, if a database client is added to the dependency list, if
anything in `src/` writes to disk, if a client IP is read, if identity
handling spreads into a module not on a short named allowlist, or if
exercising the registry leaves a single byte behind.

## Licence

MIT. Binding data derived from ChEMBL under CC BY-SA 3.0. Values are
reproduced, never imputed.
