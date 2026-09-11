# Bindery

**Science writing with a build step.**

A subscription publication for pharmacology and neuroscience where every
number in a column is a live query against a versioned dataset, and every one
of those queries is re-run whenever the dataset ships a new release.

---

## The problem

A review article is a snapshot. The databases underneath it are not.

ChEMBL ships a release every few months. A value that was a median of
fourteen measurements in 2021 is a median of thirty-one now, and sometimes the
median moves. The prose does not. Nobody re-reads a four-year-old review
against the current data, so the literature slowly accumulates sentences that
were true once.

Software had the same problem and did not solve it by writing more carefully.
It solved it with continuous integration: every change re-runs every test, and
a regression announces itself. Bindery applies that mechanism to the numbers
in prose.

## How it works

An author does not type a measured number. They write the query that produces
it, and record what that query returned at the time of writing:

````markdown
Haloperidol binds the human D2 receptor with a median Ki of
{{claim:hal-d2}}, pooled across {{claim:hal-d2-docs}} independent
publications.

```claim hal-d2
dataset: receptorome-ki
metric:  median_ki_nm
subject: DRD2
object:  haloperidol
scope:   all
value:   1.549 nM
tolerance: 10%
```
````

The reader gets the value the dataset holds *now*, rendered at read time, with
a coloured dot carrying the verdict of the last check run. The `value:` line is
never displayed — it exists so CI has something to compare against.

Three verdicts:

| Verdict | Meaning |
| --- | --- |
| **verified** | Within the tolerance the author set. The sentence still says what it said. |
| **drifted** | Both values exist and differ by more than the tolerance. The number on the page is current; the argument around it may not follow. |
| **broken** | The query no longer resolves. A unit mismatch counts as broken, not drifted — `1.55 nM` against `1.55 µM` is not a 0% drift, it is a question the runner is not allowed to answer by guessing a conversion. |

Checks run on publish, on demand, and — the one that matters — on every
dataset release:

```bash
npm run db:release                 # re-import the snapshot, re-check everything
npm run db:release -- --simulate   # model an upstream release that moves values
```

`--simulate` perturbs three cells to model ChEMBL adding papers, then cascades.
Two columns flip from passing to drifted with the responsible claims named; a
control cell that moves 4% inside a 15% tolerance correctly stays green. It is
labelled in the dataset's own release string and provenance notes, because a
publication whose premise is traceable numbers should not quietly sit on
fabricated ones.

## What else GitHub actually contributed

Version control was never the interesting part. What changed software was that
every change got diffed, reviewed and re-tested. So:

- **Revisions.** Every publish is a commit with a message, not a
  last-modified timestamp.
- **Forks.** Copy a column into a draft you own, lineage recorded and shown on
  the published page. A copy, not a live reference — a fork is a claim that
  your version stands on its own.
- **Proposals.** The pull request. Edit the text, say why, and the author
  reviews a unified diff. Merging writes a revision crediting the proposer and
  re-runs CI; if a claim comes back broken the merge is rolled back rather than
  published.
- **Repository pinning.** A column names the GitHub repo and commit that
  produced its analysis, so the prose, the data snapshot and the code all point
  at each other.

## What it does not do

It does not check reasoning. A column can be entirely green and still draw a
conclusion the numbers do not support — one of the seeded columns is partly
about exactly that failure. Checked claims remove the silent-rot class of
error and leave every other class where it was.

It does not improve the underlying data either. The seeded dataset has cells
resting on a single measurement from a single paper. Those cells are checkable
and still thin, which is why every claim carries its evidence count beside its
value.

## The dataset

The evidence layer is a vendored snapshot of the
[receptorome](https://github.com/jtchang/receptorome) pipeline: median Ki and
pKi for eight antipsychotics across ten aminergic GPCRs, derived from ChEMBL
release 37.

Its discipline is carried through to the UI rather than flattened into it:

- **Ki only.** IC50 and Kd are landed for context and never converted.
- **No imputation.** Empty cells stay empty and are listed by name. Three of
  the eighty cells have no data at all; they are named on the dataset page.
- **Censored is not missing.** `>10000 nM` is a measurement and a true
  negative. Counted separately, never folded into the empty count.
- **Coverage is a ladder, not a number.** 96% have any measurement; 88% have a
  point estimate from a confirmed-human assay. Which one you should quote
  depends on what you intend to do next.

## Running it

```bash
npm install
cp .env.example .env.local     # the defaults work as-is for local development
npm run db:push                # create the SQLite database
npm run db:seed                # dataset, users, five columns, one CI run each
npm run dev
```

Open <http://localhost:3000>. Seeded logins, all with password `binderydemo`:

| Email | Role |
| --- | --- |
| `demo@bindery.science` | reader, no subscription |
| `marcus@bindery.science` | author |
| `elena@bindery.science` | editor |

### Authentication

Google and GitHub OAuth are wired and need credentials only the owner of a
deployment can create; set `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` and
`AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` to enable them. Until then they render
as disabled buttons naming the variables they want, rather than disappearing.

With `AUTH_DEV_OAUTH=1` a local OAuth identity provider is mounted at
`/api/dev-oauth`. It is not a mock of Auth.js — it is a mock of the *identity
provider*, which is the part that cannot be provisioned locally. The full
authorize → code → token → userinfo → account-linking flow runs exactly as it
will against Google.

### Billing

The application talks to a narrow `StripeGateway` port, and one environment
variable decides which implementation answers.

- **`STRIPE_SECRET_KEY` set** → the real Stripe SDK. A test key gives Stripe
  test mode; a live key gives live mode. Going live is a key swap plus the
  `STRIPE_PRICE_*` ids, and nothing else.
- **unset** → a local stand-in that stores customers, subscriptions and
  invoices, serves a stand-in checkout page, and posts *genuinely signed*
  webhook events back to this application's real `/api/stripe/webhook`.

Signature verification, event idempotency, the subscription state machine and
the entitlement rules are the same code in both modes. A forged signature gets
a 400 either way. The account page grows a set of local controls that fire the
events Stripe would send over the following days — a successful retry, an
exhausted dunning cycle, a period rollover — so the lifecycle is walkable now
rather than in a week.

One judgement call worth knowing about: `past_due` keeps access. Stripe retries
a declined card over several days, and cutting someone off at the first decline
punishes an expired card rather than a decision to leave. Access ends at
`unpaid` or `canceled`. Cancellation is always at period end — someone who paid
for the month keeps the month.

## Plans

| | Reader | Member | Lab |
| --- | --- | --- | --- |
| | Free | $9/mo · $90/yr | $29/mo · $290/yr |
| Open columns in full | ✓ | ✓ | ✓ |
| Member columns | preview | ✓ | ✓ |
| Claim inspector | | ✓ | ✓ |
| Dataset explorer | | ✓ | ✓ |
| Propose edits and fork | | ✓ | ✓ |
| Lab columns | | | ✓ |
| The studio and your own datasets | | | ✓ |

## Stack

- **Next.js 16** — App Router, Turbopack, React Server Components
- **TypeScript** in strict mode, **Tailwind CSS v4**
- **Drizzle ORM** over **libSQL** — a file in development, a Turso URL in
  production
- **Auth.js v5** — Google, GitHub, email/password
- **Stripe** — behind a port, with a local stand-in for the counterparty
- **Vitest** — the claim parser, the drift judge, the access policy, the
  subscription projection and the differ are pure and covered

## Layout

```
src/
  app/                 routes; (auth) and dev/ are grouped separately
  components/          view layer, mostly server components
  lib/
    access.ts          who can read what, no I/O, tested
    claims/
      syntax.ts        the claim grammar, pure
      verdict.ts       the drift judge, pure
      engine.ts        the CI runner, takes its db handle as an argument
      runner.ts        the same engine bound to the app's handle
    collab/            forks and proposals
    diff.ts            line diff for proposal review, pure
    stripe/
      plans.ts         the only price table
      projection.ts    Stripe subscription -> stored row, pure
      gateway.ts       one switch between live and local
      live.ts local.ts the two implementations
    studio/            authoring
content/seed/          the five seeded columns, as authored
data/receptorome/      the vendored ChEMBL snapshot
scripts/               seed, import, release
```

## Tests

```bash
npm test        # vitest
npm run lint
npm run build
```

## Licence

MIT. Binding data derived from ChEMBL under CC BY-SA 3.0. Values are
reproduced, never imputed.
