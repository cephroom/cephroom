# Cephroom

Science writing with a build step.

A review article is frozen the day it is written. The databases underneath it
are not. A Cephroom column never states a measured number directly — the author
writes the *query* that produced it, and every reader's browser re-runs that
query against the live dataset on the way in. A sentence that has quietly become
wrong says so on the page.

The platform hosts none of it. A contributor runs a small node on their own
machine that serves their columns and datasets directly to readers' browsers;
Cephroom brokers the connection, holds a fifteen-second presence lease, and
keeps no copy. Stop the process and the work leaves the site immediately —
there is no archive to fall back on, because there is no archive.

What that buys, and what it costs, is set out in [`docs/CONTRACTS.md`](docs/CONTRACTS.md).
The decisions that are not visible in the code — including the ones that were
built and then cut — are in [`docs/RESEARCH-NOTES.md`](docs/RESEARCH-NOTES.md).

---

## Run it

Requires Node 20 or newer.

```bash
git clone <this repo> && cd cephroom
npm install
cp .env.example .env.local
npm run keys:generate      # prints three lines; paste them into .env.local
npm run dev                # http://localhost:3000
```

`keys:generate` prints `CEPHROOM_SIGNING_KEY`, `CEPHROOM_PUBLIC_KEY` and
`AUTH_SUBJECT_SECRET`. Nothing else in `.env.example` has to be set — every
other value has a working default.

At this point the site runs and is empty, and says so: "Nobody is serving right
now. This is not an error state." Nothing is online because nothing is being
served, which is the architecture rather than a missing seed step.

## Serve the demo content

In a second terminal:

```bash
npm run node:serve
```

With no arguments this serves the demo that ships in the repository — six
columns and two datasets, from `node/content/` and `node/data/` — announces them
to the platform, and heartbeats to keep the lease alive. Reload
<http://localhost:3000/read> and they are there. `Ctrl-C` withdraws, and the
platform forgets immediately; there is nothing to clean up, because the
announcement was the only record.

Run a second one to see the listing interleave two contributors fairly:

```bash
npm run node:serve -- --port 4601 --name "Ada Fenwick" --sub s_node_ada
```

## Serve your own work

A column is a Markdown file with front matter: a `slug` and a `title`, plus an
optional `subtitle`, `tags`, `repo` and `commit`. Numbers go in fenced `claim`
blocks and are referenced inline:

```markdown
Haloperidol binds the human D2 receptor at {{claim:hal-d2}}.

```claim hal-d2
dataset: receptorome-ki
metric:  median_ki_nm
subject: DRD2
object:  haloperidol
value:   1.549 nM
tolerance: 10%
```
```

Point a node at a directory of them:

```bash
npm run node:serve -- \
  --content ./my-columns \
  --name "Your Name" \
  --pay-to "ko-fi.com/you, or a wallet, or nothing" \
  --port 4600
```

`--pay-to` is relayed to readers verbatim and never parsed, stored or acted on.
The platform is not party to whatever happens next and is not told that it did.

Check a column before you serve it:

```bash
npm run cli -- check ./my-columns/a-column.md
```

## Sign in locally

`AUTH_DEV_OAUTH=1` (already in `.env.example`) runs a local OAuth identity
provider at `/api/dev-oauth`, so the sign-in path is exercisable without Google
or GitHub credentials. It mocks the identity provider, not the auth code, and is
ignored in production. Google and GitHub render as disabled buttons naming the
variables they need, so a half-configured deployment says so rather than quietly
offering less.

Billing runs against a simulated counterparty under `simulated-counterparties/`
until `STRIPE_SECRET_KEY` is set. The pricing page says so in a banner.

## The command line

```bash
npm run cli -- live [query]        # what is being served right now
npm run cli -- read <sub> <id>     # fetch a column and check every claim locally
npm run cli -- check <file.md>     # check a column's claims before serving it
npm run cli -- tokens              # top up anonymous search tokens
npm run cli -- login [key]         # store a renewal key
```

`read` does the same work the browser does, through the same resolver, and
reports the same verdicts.

## Checks

```bash
npm test        # vitest — unit, node, and the contract suite
npm run typecheck
npm run lint
```

All three run in CI on push and pull request.

`tests/contracts/` is the part worth knowing about. It is a static analyser over
the source tree plus behavioural assertions, and it enforces the eleven
contracts rather than describing them — "no user table" is a test that fails
when a schema file appears, and "we never read your IP address" is a test that
fails on the line that would read it. Several of the guards fail in both
directions: a permitted exception that stops being used fails too, so an
exemption cannot outlive its reason.

`tests/contracts/scanner.test.ts` tests the analyser itself, because a
grep-based guard that silently stops matching is worse than no guard.

## Layout

```
src/app/          the platform: pages and API routes
src/lib/          claims, keys, signaling, tokens, zk, stripe
node/             a contributor's node — their process, their disk
node/content/     the demo columns a fresh clone serves
scripts/          the CLI and key generation
simulated-counterparties/   stands in for Stripe in development
tests/contracts/  the eleven contracts, as tests
docs/             the contracts, and the reasoning behind them
```

`node/` is not part of the platform. It runs on a contributor's machine, holds
their content and their proposal inbox, and talks to the platform only to
announce presence and to fetch the public key it verifies reader keys against.

## Licence

MIT, for the platform code. Binding data under `node/data/` is derived from
ChEMBL under CC BY-SA 3.0; values are reproduced, never imputed.
