# Contributing to Cephroom

Two things are worth reading before anything else:

- **[tests/contracts/](tests/contracts)** — the constraints that govern this
  platform, written as tests rather than as prose. They are not preferences,
  and a change that violates one fails the suite rather than reaching review.
  Each file's docstring says what it is defending and what went wrong before
  it existed.
- **[AGENTS.md](AGENTS.md)** — the bugs this repository has already had, where
  the invariants live, and which test holds which contract.

## Running it

Two processes.

```bash
npm install
cp .env.example .env.local
npm run keys:generate        # paste the three lines into .env.local
npm run dev                  # the platform, on :3000

# in another terminal
npm run node:serve           # a contributor's node, on :4600
```

Open <http://localhost:3000/read>. If nothing is listed, the node is not
running — there is no fallback content, by design.

## Before you open a pull request

```bash
npm test          # the whole suite, contract tests included
npm run build     # type errors surface here that tsc alone may not
```

Then open it in a browser, with a node running, and look at it. Four of the
bugs in this repository's history passed both commands above and were visible
only on the rendered page.

## What will get a change rejected

- **Adding a database, an ORM, or any durable store.** There is none, on
  purpose. If something appears to need durable state, it belongs on the
  contributor's node or at Stripe.
- **Storing anything about a person.** No user rows, no profiles, no sessions,
  no mirror of a subscription. `tests/contracts/identity-surface.test.ts`
  keeps the list of modules allowed to touch identity short and explicit.
- **Holding content on the platform.** Column bytes go from the author's
  machine to the reader's. The platform learns an id, a title and an address,
  in memory, for the length of a lease.
- **Reading a client IP**, adding analytics, or adding an error reporter that
  captures identity.

If you genuinely need to bend a contract, widen the allowlist in the test that
guards it, with a reason, in the test itself. Every one of them is written so
that widening it is a visible diff — and so that the reason lives next to the
assertion rather than in a document that can be deleted out from under it.

## Writing a column

You do not need permission or an account here — run a node and serve it. The
claim syntax is documented at `/how-it-works`, and the short version is that
you never type a measured number:

````markdown
Haloperidol binds D2 at {{claim:hal-d2}}.

```claim hal-d2
dataset: receptorome-ki
metric:  median_ki_nm
subject: DRD2
object:  haloperidol
value:   1.549 nM
tolerance: 10%
```
````

The editorial standard is the same one the data layer holds itself to: no
imputation, no conversion between activity types, and every value carries the
evidence count behind it. A number without an *n* is a rumour with a decimal
point.

## Style

Match the surrounding code. Comments explain *why*, particularly where a
decision looks arbitrary — the tolerance model, `past_due` keeping access, a
unit mismatch counting as broken rather than drifted. Those are judgement
calls, and a reader six months from now deserves the reasoning rather than a
restatement of the code.

## Licence

MIT. By contributing you agree your contributions are licensed under it.
