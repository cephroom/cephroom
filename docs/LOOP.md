# The loop

The improvement loop this project runs. The base steps come from the project
brief; the sections below are steps I added because a cycle kept turning up
work that none of the base steps owned. Each addition says why it earned a
place. The loop is extendable, not shortenable — every step produces something
every cycle.

## Base steps (each produces an artifact every cycle)

1. **Research** → `docs/RESEARCH-NOTES.md`. Read real scientific writing and
   the vendored pipeline's verification record; record what researchers need.
2. **Visit** → `docs/COMPETITIVE-NOTES.md`. Visit real products as a reader;
   record patterns to adopt and, as importantly, patterns the contracts force
   us to reject.
3. **Role-play**. Walk both roles from zero in the browser — contributor and
   viewer, separately, then together.
4. **Attack** from inside every role — stranger, free-tier user, contributor,
   viewer, former subscriber, colluding pair. Local dev server only.
5. **Optimize UI/UX** — improve what already works, not only fix defects.
6. **Fix, improve, extend**, then return to 1.

The three contracts in `docs/CONTRACTS.md` outrank every step. They are
enforced by tests in `tests/contracts/`, not by discipline.

## Added steps

### A. Robustness on a flaky network (added 2026-09-12)

**Why:** This is a peer-to-peer read model — every column is fetched from a
stranger's machine over an unknown network. A base "fix defects" step catches
things that are wrong; it does not catch a plain `fetch` to a node that hangs
rather than closes, which never settles and spins the reader forever. That is
not a defect in any single render — it is a whole class of failure the P2P
architecture invites, so it deserves its own recurring check.

**What it does:** Every request to a node goes through `fetchWithTimeout`
(8 s), which aborts and surfaces "node stopped answering" instead of an
infinite spinner. Each cycle: exercise a slow, hung, and dropped node and
confirm the reader degrades cleanly. Covered by
`src/lib/fetch-with-timeout.test.ts`.

### B. Accessibility pass (added 2026-09-12)

**Why:** The audience is researchers, including ones using screen readers and
keyboard navigation. Nothing in the base steps forces a check that the search
box has a label, that the verdict dots are not the *only* signal of a claim's
state, or that the key menu is reachable by keyboard. A publishing surface
that a blind researcher cannot read has failed at its one job.

**What it does:** Each cycle, audit one surface for: labelled controls,
non-color-only status (verdict chips carry text, not just a dot), focus order,
and `aria-current`/`aria-expanded` on interactive chrome. Fix what is found.

### C. Narrow-viewport check (added 2026-09-12)

**Why:** The reading surface is long-form prose and wide data matrices. Wide
tables that force the whole page to scroll horizontally are the classic
mobile failure, and only a real narrow-viewport render catches them. The base
steps do not require it.

**What it does:** Each cycle, render the core pages at 360 px in an isolated
frame and assert nothing overflows the viewport width (matrices scroll inside
their own container). Confirmed clean in the initial build; re-checked when a
page gains a table or a wide element.

### D. Audit our own defaults (added 2026-09-12, cycle 3)

**Why:** Two findings this cycle were the same shape and neither came from any
existing step. `scope:` defaulted to `all`, and every claim in every shipped
column had taken that default without anyone choosing to pool across organisms.
`scopesForTier` granted `serve:node` to Lab alone, and the plan copy sold
publishing as a paid feature that no code enforced. Both were *defaults and
declarations nobody re-read after writing* — invisible to attack (they are not
exploitable), invisible to role-play (nothing is broken), and invisible to
testing (the tests agreed with the code).

NeuroVault is the same failure at scale: 107 metadata fields, ~60 describing
the analysis pipeline, and ten filled on NARPS's own submissions. The schema
was right and nothing depended on it.

**What it does:** Each cycle, pick one default or one piece of product copy and
check it against what the code does and what the contracts say. Ask of each
default: would anyone have chosen this on purpose? If the honest answer is
"they just did not type the line", the default is wrong and should be an error.
If a plan or a page claims something, find the line that enforces it.

## Notes on running it

- No checkpoints; commit as you go. The git history is the report.
- A step that produced nothing means the cycle was incomplete — go back.
- Findings are not deferred to "next cycle." Next cycle has its own.
