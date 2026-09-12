# Research notes

What actual scientific practice tells us researchers need from a platform
like this, and how each need maps to the product. Grounded where possible in
the vendored cephroom pipeline's own verification record
(`C:\dev\cephroom\docs\VERIFICATION.md`, ChEMBL_37, verified 2026-08-06),
which is a primary source for how binding data behaves in practice.

Each cycle adds to this. Entries are dated.

---

## 2026-09-12 — Provenance is the product, not a footnote

### What the data actually does

The cephroom verification doc is a catalogue of ways a number betrays you:

- **ChEMBL silently ignores unknown query parameters.** A typo in a filter
  name returns HTTP 200 and the *entire* 24.5M-row activity table rather than
  an error. A pipeline that trusts its own query strings manufactures a
  spectacularly well-populated matrix out of a spelling mistake.
- **Assay organism does not live on the activity record.** `target_organism`
  is always *Homo sapiens* because targets were filtered to human — but that
  says nothing about where the experiment ran. Rat-brain measurements carry a
  human `target_organism`. The real species is on `/assay`, fetched
  separately and joined. Using the wrong field manufactures human provenance.
- **A censored measurement (`>10000 nM`) is a true negative, not missing
  data.** Folding it into "no data" destroys exactly the information a
  target-deconvolution method needs.

The lesson is not "ChEMBL is bad." It is that **a value is only meaningful
with its provenance attached**: which release, which assay, which organism,
how many measurements, from how many papers, and what was deliberately
excluded. A bare number is a rumour with a decimal point.

### What this means researchers need

1. **The number and its evidence together, inseparably.** Not "Ki = 1.55 nM"
   but "1.55 nM, 104 measurements across 93 papers, ChEMBL_37, human assays."
   → The claim system already carries this: every rendered value has its
   query, evidence count, and dataset release one click away. This is the
   single most-validated need and the product's core bet. Keep it central.

2. **Reproducibility pinned to a snapshot.** "The median moved between
   releases" is the normal case, not the exception. A citation that cannot
   name the release it was true for is not reproducible.
   → Claims name a dataset release; the reader's browser re-checks against
   whatever is served now and shows drift. Gap worth noting: there is no way
   for a reader to pin *the release a column was written against* if the
   author is no longer serving that snapshot. Under Contract 3 (no data at
   rest) the platform cannot hold old snapshots — so reproducibility of a
   dormant column depends on someone serving that snapshot. This is an honest
   limitation of the architecture, not a bug. Recorded so it is not "fixed"
   by quietly caching.

3. **Absence stated explicitly, by name.** Researchers distinguish "measured
   and negative" from "not measured." A matrix that renders both as blank is
   actively misleading.
   → The dataset explorer lists empty cells by name and counts censored-only
   cells separately. Correct. Do not let any future "cleanup" zero-fill them.

4. **No silent unit or type coercion.** IC50 is not Ki; nM is not µM. The
   pipeline refuses to convert; the claim judge treats a unit mismatch as
   `broken`, never a 0% drift.
   → Already enforced and tested. This is a differentiator versus generic
   data tools that happily coerce.

### Implication for the GitHub-for-science thesis (Contract 1)

GitHub's value was never storage — it was that every change is diffed,
reviewed, and re-tested, and that provenance (who changed what, against which
base) is inescapable. The scientific analogue is not "host the PDF." It is:
a claim is a query against a versioned dataset, a reader re-runs it, and a
proposal is a diff the author reviews. That is what makes this a GitHub for
science rather than a paywalled journal. Every feature decision should be
measured against whether it strengthens *that* loop.

### Not yet served, worth considering in later cycles

- **Multiple datasets per node.** A node serves one dataset today; a real
  author often checks claims against several. The node's `/dataset/<id>`
  route already keys by id, so this is a node-side extension, not a platform
  change — and it stays contract-clean because the data still lives on the
  author's machine.
- **Claim provenance beyond a single value.** Researchers cite ranges, IQRs,
  and per-source disagreement (the pipeline computes fold-spread and IQR-fold
  per cell). A claim can currently assert a median or an evidence count;
  asserting "the IQR is within 2x" would let an author stake a claim about
  *agreement between labs*, which is often the real scientific point.

### The paywall preview has to carry verifiable claims (cycle 2026-09-12)

Working the paywall boundary this cycle surfaced a design point that is
specific to *scientific* writing and would not come up for a generic blog.
A normal paywall teaser shows the first few paragraphs and cuts off; the
numbers in it are decoration, and nobody checks them. Here the preview
paragraphs contain claims — `1.55 nM`, `93 papers` — and the whole promise
of the product is that a reader can verify those against the dataset in
their own browser.

So the gate cannot simply truncate. It withholds the prose past the preview
and the Markdown source (which carries every claim *definition*, and is what
a proposal edits), but the parsed claim *results* for the preview still
travel and still resolve against the node's dataset. A free reader sees a
short excerpt whose numbers are genuinely checkable — which is a more
honest teaser than most paywalls manage, and it is only possible because
verification is client-side and does not require the source.

The inverse is the real risk: shipping a preview whose numbers a reader
*cannot* check is worse than no preview, because it invites trust in an
unverifiable figure. `gateColumnBody` and its tests now hold that line.

### Claim-expressiveness gaps the data already supports (cycle 2026-09-12)

The node reads the whole of `gap_report.json` on startup and then throws most
of it away — it flattens only `value, nPoints, nDocs, foldSpread,
foldSpreadIqr` into the facts it serves. Several scientifically sharper
assertions are sitting in that file, per cell, unclaimable. Each is
contract-clean by the same argument the fold selects were: the datum is on the
contributor's disk, served with the dataset, checked in the reader's browser —
no platform state. Verified against ChEMBL_37 (80 cells).

Ranked by value-to-effort:

1. **Censored fraction** (`n_censored / n_measurements`). Lets an author
   positively assert "the only evidence here is a `>` ceiling." A
   `censored_only` cell (e.g. CHRM1 × aripiprazole, `n_point=0`) has no median
   — a `value` claim on it is already `broken` — but a `censored_fraction`
   claim resolves to `1.0` and states the ceiling *as a fact*. Trivial: both
   numbers are already on the indexed cell; reuse `judge()` unchanged.

2. **Organism provenance** (`organism_verdict`: human_present / non_human_only
   / unknown_organism_only / no_data). Answers the one question the rat-brain
   provenance note is about — "is this a human number?" HTR2B × haloperidol is
   `non_human_only`; a sentence citing it as human renders green today. Best as
   a *categorical* select: exact match → verified, mismatch or missing → broken
   (no `drifted` state — provenance either matches or it does not), which needs
   one small judge branch.

3. **PDSP cross-source agreement** (`pdsp_cross_check.comparison[].fold_difference`).
   The strongest "GitHub for science" primitive in the file: an *independent*
   database (PDSP Ki DB) re-checking the number, client-side, at read time.
   HTR2B × ziprasidone is the one flagged conflict — ChEMBL 1.58 nM vs PDSP
   27.23 nM, 17.2× apart. Add `pdsp_fold` to `FOLD_SELECTS` so it inherits the
   dimensionless-ratio handling; index `comparison[]` by `gene|compound` the
   way `cellByPair` already indexes cells. Must map `chembl_n=0`/NaN rows to a
   *missing* fact so they resolve `broken`, never `0×`.

Recorded-and-rejected: a **cross-document-disagreement** select would duplicate
`fold_spread` — in this dataset every extreme measurement is its own document,
so `spread.cross_document_disagreements[].fold_difference` equals the cell's
`fold_spread` for all 40 disagreeing cells (checked). The only genuinely new
piece there is the min/max document CHEMBL IDs, which is provenance, not a
number. Not worth a select.

### Shipped: censored_fraction; the censored-only limitation (cycle 2026-09-12)

Built the top-ranked gap from the entry above. A claim can now `select:
censored_fraction` and assert what share of a cell's measurements are censored
ceilings (a `>` bound) rather than true values — e.g. the D2 window column now
states, checkably, that only 1.23% of the DRD2 × clozapine measurements is a
ceiling, so its wide fold spread is real disagreement and not a detection-limit
artefact. Written as `0.07` or `7%`; the node serves `nCensored`/`nMeasurements`
per cell and the fraction is computed in the reader's browser.

Known limitation, deferred honestly: a **censored-only** cell (no point estimate
at all — CHRM1 × aripiprazole, `n_point=0`) produces *no fact*, because the node
drops empty cells so a claim against one fails loudly rather than resolving to
"no data" (AGENTS.md). So the most dramatic case — positively asserting a cell
is entirely a ceiling (fraction 1.0) — currently resolves broken, not 1.0. To
support it the node would have to emit a fact for censored-only cells carrying
the counts without a median, which is a fact-model change (every fact has a
numeric value today). Worth doing, but it is a real change, not a tweak, so it
waits rather than shipping half-done.

---

## 2026-09-12 (cycle 2) — Species is not a caveat, it is part of the number

### What the literature says

Read two papers on how binding affinities behave across species and across
databases.

**Proudman et al., *Pharmacology Research & Perspectives* (PMC8882856)** —
affinity of antipsychotics and related ligands at human α2A/α2B/α2C
adrenoceptors, with explicit species comparison:

- Species differences reach **30-fold** — yohimbine and rauwolscine bind
  human/pig α2A far tighter than rat/guinea pig.
- They **flip direction by ligand**: prazosin runs the other way, 15–20× 
  *higher* at rat/mouse than at human/rabbit/dog.
- Human α2-adrenoceptors resemble pig, dog and rabbit more than they resemble
  rat, mouse and guinea pig — the common lab species are the distant ones.
- Even holding species fixed, reported prazosin affinity at human α2A spans
  **50-fold** (300 nM to 16000 nM), and buffer choice alone moves a
  radioligand's affinity 4–5×.

**Kuhne et al., histamine receptor comparison of the PDSP Ki DB against
IUPHAR/BPS (PMC13494103)** — two curated databases over the same receptors:

- pKi deviations between the two reach **3.4 units** at hH1R and hH4R.
- Native tissue versus recombinant preparation deviates by up to **4.16 pKi
  units**, and the worst example they name is **olanzapine at hH1R**.
- Their warning is the sharpest sentence in either paper: *"apparent 'missing
  data' may partly reflect differences in database design"* rather than true
  absence.

The load-bearing consequence: **a species difference is not a bias that can be
corrected, because it has no consistent sign.** There is no factor to divide
out. The only honest handling is to state which organism a number came from
and let the reader see it.

### What the dataset says

Checked this against ChEMBL_37 as served (80 cells). `gap_report.json` already
carries `median_nm` (pooled over every organism) and `median_nm_human`
alongside each other, plus an `organism_verdict` per cell:

| organism_verdict | cells |
| --- | --- |
| `human_present` | 74 |
| `no_data` | 3 |
| `non_human_only` | 2 |
| `unknown_organism_only` | 1 |

**40 of 80 cells — exactly half — have a pooled median that differs from the
human-only median**, by up to 2.51× (CHRM1 × chlorpromazine, 50.18 nM pooled
vs 125.89 nM human). The direction flips cell to cell, exactly as the α2A
paper describes.

### The finding that matters: it changes an argument we ship

`histamine-sedation.md` argues that ranking antipsychotics by H1 affinity
alone predicts **clinical sedation in patients** better than the multi-receptor
models that replaced it. The ranking *is* the argument. Recomputed at human
scope:

```
pooled: clozapine < chlorpromazine < olanzapine < quetiapine < ...
human : clozapine < olanzapine < chlorpromazine < quetiapine < ...
```

Chlorpromazine and olanzapine **swap**. A column about a human clinical
outcome is ranked on medians that pool rat and human measurements, and the
ordering is not robust to the distinction.

(The honest other half: chlorpromazine's human-only median rests on a single
measurement, `n_human_point = 1`. Human scope is not automatically the better
number — it is a *different* number with a different evidence count, and the
author has to be able to say which one they mean and show what stands behind
it. That is an argument for making scope visible and claimable, not for
switching the default.)

### The product gap this exposes

Three things, all on the author's disk already, none of them reachable:

1. **There is no `median_ki_nm` at human scope.** The node emits
   `median_ki_nm`/`all`, `median_pki`/`all` and `median_pki`/`human`. An
   author who wants a human-only affinity **in nanomolar** — the unit every
   column actually writes in — cannot express it. Their only human option is
   pKi, a log unit that reads unnaturally in prose. So the path of least
   resistance is the species-pooled number.

2. **`scope` defaults to `all`.** Every claim in all five shipped columns is
   `scope: all` — not because anyone chose pooling, but because it is what you
   get by not typing the line.

3. **`organism_verdict` is never served.** A cell that is `non_human_only`
   (HTR2B × haloperidol) renders exactly like a cell with 45 human
   measurements. Nothing on the page distinguishes them, and no claim can
   assert the difference. This is gap #2 from the previous cycle's ranked
   list, and the literature above is what promotes it from "nice" to
   "the page is currently able to mislead".

Building all three this cycle.

---

## 2026-09-12 (cycle 3) — In neuroscience the number is a property of the pipeline, not of the data

The platform's scope widened from pharmacology to the nervous system generally,
so this cycle's reading went outside binding affinity to ask the same question:
what makes a number in a neuroscience paper untrustworthy, and can this
platform's machinery catch it?

### What the literature says

**Botvinik-Nezer et al., *Nature* 582 (2020) — NARPS.** Seventy independent
teams analysed **one** fMRI dataset against **nine** pre-registered hypotheses.

- **"The proportion of teams reporting a significant effect ranged from 0% to
  100% across the 9 hypotheses."** For several, roughly half the teams said yes
  and half said no.
- **"Correlations between unthresholded statistical maps across teams ranged
  from r = −0.34 to r = 0.99."** Teams disagreed on the sign of the effect,
  not merely its size.
- No two teams chose the same workflow. Seventy teams, seventy pipelines.
- A meta-analysis across teams did recover a consensus — the disagreement is
  in the *analysis*, not in the data.

**Mostafa et al., *Front. Syst. Neurosci.* (2025) — motor-imagery decoders,
offline benchmark versus real-time use.** Ten deep decoders, same task:

- EEG-TCNet: **59.45% offline (±3.33) versus 70.0% online (±5.3)** — the same
  decoder, eleven points apart, because the protocol changed.
- MSVTNet ranged **62.23% to 75.56%** across subjects online.
- Only **two of ten** architectures reached the 70% usability threshold online.
- "results show shifts in performance ranking between offline and online BCI
  settings" — the *ordering* of methods is not stable either, which is exactly
  the failure the D2 column's H1 ranking hit last cycle, one level up.

**Wang et al., *EEG-FM-Bench* (arXiv:2508.17742).** "Current evaluations rely
on inconsistent protocols that render cross-model comparisons unreliable."

**Chevallier et al. (arXiv:2512.02978), 340,000+ pipeline configurations over
three open motor-imagery datasets.** Their conclusion is the general form of
all of the above: "no universal 'one-size-fits-all' method can optimally decode
EEG motor imagery patterns across all users or datasets", and nonlinear methods
beat spatial ones *for specific individuals*.

### The thing these four have in common

A binding affinity is a property of a receptor preparation. **A decoding
accuracy, a cluster-corrected activation, a spectral peak is a property of a
pipeline applied to data.** Take the same bytes, change the smoothing kernel or
the window length or the cross-validation split, and the number moves — in
NARPS's case, far enough to flip the conclusion.

That is not a caveat to be footnoted. It is the same structural point last
cycle reached about species: a difference with **no consistent sign**, so there
is no factor to divide out and no default that is quietly correct. The only
honest handling is to state which analysis produced the number and let the
reader see it.

### Where this platform is currently able to mislead

The fact model in `node/server.ts` is:

```
{ subject, object, metric, scope, value, unit,
  nPoints, nDocs, foldSpread, foldSpreadIqr, nMeasurements, nCensored, pdspFold }
```

and a claim resolves a fact by `(dataset, metric, subject, object, scope,
select)`. Three consequences, in increasing order of severity:

1. **`subject` and `object` are just strings**, and the resolution is a key
   lookup — so the *mechanism* already generalises. (receptor × compound) is
   not privileged; (dataset × decoder) or (region × band) resolve identically.
   The pharmacology assumption is in the vocabulary and the examples, not in
   the machinery. That is much less work than it looked.

2. **`select: fold_spread` asserts disagreement between laboratories.** It
   exists because a cell with a tight median and a 100× full spread is
   unresolved rather than settled. This is precisely the quantity NARPS says
   matters most — except NARPS's spread is across *pipelines*, and there is
   nowhere to put one.

3. **There is no slot for the analysis.** A fact carries `scope`, which is used
   for organism. Nothing carries preprocessing, window, split or model. So a
   claim can state `72.4%` as though it were a property of a dataset, with a
   green verdict, and be exactly as misleading as ChEMBL's `organism: Homo
   sapiens` header — a clean two-word fact at the top of the page that is true
   of the *target* and says nothing about where the measurement happened
   (docs/COMPETITIVE-NOTES.md, cycle 2).

Point 3 is the gap worth building. A platform whose entire thesis is that a
number carries its provenance, shipping a fact model with no room for the
single largest source of variance in its new subject area, would be asserting
rigour it does not have.

### What is being built this cycle

- A **`method` dimension** on a fact and on a claim: the pipeline that produced
  the number, resolved like `scope` is. Omitting it does not silently pool —
  the same mistake `scope: all` made by default.
- **`select: method_spread`** — the NARPS quantity. The ratio (or point spread)
  across the methods that produced the same cell, so an author can assert, in
  prose and checkably, *how much this number depends on how you computed it*.
- A **non-pharmacology dataset and column** shipped in the node, so the
  generalisation is demonstrated rather than claimed. A motor-imagery decoding
  matrix is the right choice: it is the case the literature above measures, and
  it makes every pharmacology assumption in the UI visible by breaking.

---

## 2026-09-12 (cycle 3, second pass) — What a membership should cost, and who it should pay

Asked to make the plans reasonable and friendly to both sides. Two reference
classes matter, because this product sits between them.

### Creator platforms: the platform takes 0–15%, the creator takes the rest

| Platform | Platform cut | Notes |
| --- | --- | --- |
| Substack | ~10% + Stripe | ~13–15% effective on gross |
| Patreon | up to ~10% | tier-dependent |
| Ghost (self-hosted) | 0% | you pay hosting instead |
| Ghost Pro | 0% on revenue | hosting is the fee |

The shape is consistent: **the platform's cut is the minority share, and the
person who wrote the thing gets the rest.**

### Learned societies: dues are tiered by career stage, steeply

| | Regular | Postdoc | Grad student | Undergrad |
| --- | --- | --- | --- | --- |
| SfN (1 yr) | $245 | $185 | **$95** | **$38** |
| OHBM | $220 | — | **$100** | — |

Graduate students pay **39%** of the regular rate at SfN, **45%** at OHBM.
Both also reduce for members in countries the World Bank classifies as
developing. Both verify — SfN wants a letter from a department head.

Two things follow directly.

**A reduced rate is a norm in this field, not a growth tactic.** A platform for
researchers with a single price is priced wrong for most of its audience. Built
this cycle at $36/yr against $90.

**We cannot verify it, and should not pretend to.** Verification means holding
a record of who proved what, which Contract 1 forbids. So it is asked for and
not proved, and — importantly — **nothing marks a reduced-rate key**. A `tier`
that said "student" would be a durable fact about a person riding around in
their browser, which is the thing the contract exists to prevent. The reduced
rate is a *price*, and the tier it buys is identical.

### The finding that is not about price

Against the creator-platform column, this platform is an outlier in a way the
pricing page was actively obscuring. **Contributors receive nothing.** They run
the node, pay the bandwidth, hold the uptime — and readers pay us $9–29 a month
for access to their columns. The page said "Membership pays for the writing."
It does not. That sentence is now gone.

Under Contract 0 this is also a thesis problem, not only a fairness one: GitHub
does not charge readers to read your repository. A "GitHub for science" whose
revenue is a toll on other people's work is not obviously the thing it claims
to be.

The honest obstacle, stated rather than dodged: **splitting revenue fairly
requires counting who read what.** A per-contributor read ledger is durable
state about people, keyed to identity, and it is exactly what Contract 1
forbids. Every scheme that starts "just count reads and divide" ends at a user
table.

What is possible without one, ranked:

1. **A contributor charges from their own node, with their own payment
   relationship, and we take no cut.** Available today in principle — the node
   is already the enforcement point and the platform is not in the request
   path. Costs us nothing, needs no ledger, and no read count. It moves the
   toll off the platform entirely.
2. **A flat, equal split among contributors who served during the period**,
   with no regard to how much anyone read. Needs a list of who was live, which
   the presence registry has in RAM — but *paying* them needs it to survive the
   period, and that is a durable list of contributors. Probably fails the
   contract; recorded so the next cycle does not re-derive it.
3. **Reader-directed allocation**: the reader nominates who their fee goes to.
   Stripe holds the mapping, not us. Plausible, and the most contract-shaped of
   the three, but it is a real product design rather than a tweak.

Not building any of them this cycle, because which one is right is a business
decision about what this product is, not a defect to be fixed quietly. What was
built is everything that needed no such decision: the false sentence removed,
the obstacle stated on the pricing page where a prospective contributor will
see it, the imaginary paywall on publishing deleted, and the reduced rate
shipped.

---

## 2026-09-12 (cycle 4) — A point estimate is not a result, and I shipped nine of them

### What the literature says

**Calin-Jageman & Cumming, *eNeuro* 6(4) ENEURO.0205-19 (2019), "Estimation for
Better Inference in Neuroscience."** The case against reporting a number
without its uncertainty, in this field specifically.

- The prescription: *"Pose quantitative research questions and report
  quantitative answers (effect sizes). Countenance uncertainty in all
  statistical conclusions by reporting and interpreting the potential for error
  (interval estimates)."*
- The scale of the problem: *"Median sample size in this field is only 49 total
  participants, meaning expected sampling error is much larger (∼0.55 SD) than
  the typical reported effect"* — for the oxytocin literature they analyse, an
  effect of about 0.28 SD. **The noise is twice the signal.**
- The named failure mode, and it is the one that matters here: a result
  significant in trust games and not in risk games, where *"there is
  substantial overlap in the interval estimates… many compatible effect sizes
  in common."* Two numbers look different. The difference is not one.

### The finding, which is against this repository

Cycle 3 shipped `mi-decoders-2025` and a column built on it. The dataset file
carries `offline_sd` and `online_sd` for every row. **The node serves the means
and drops the standard deviations on the floor.** A reader sees `59.45 %` and
has no way to learn that its SD is 3.33 and n is 4.

Computing what the served numbers cannot say (SE of the difference from the two
reported SDs at n = 4):

| decoder | online − offline | SE of difference | ratio | bigger than its own spread? |
| --- | --- | --- | --- | --- |
| EEG-TCNet | +10.55 | 3.13 | 3.38 | **yes** |
| EEGNet | +7.90 | 4.30 | 1.84 | no |
| Shallow FBCSP Net | +6.89 | 4.53 | 1.52 | no |
| EEG Conformer | +6.65 | 3.53 | 1.88 | no |
| MSVTNet | +4.22 | 3.93 | 1.07 | no |
| SCCNet | +3.24 | 2.91 | 1.11 | no |
| FBCNet | −2.02 | 2.99 | 0.68 | no |
| Attention BaseNet | +1.89 | 4.11 | 0.46 | no |
| FBLight ConvNet | +1.44 | 2.23 | 0.65 | no |
| IFNet | +1.00 | 3.66 | 0.27 | no |

**One of ten.** Nine protocol gaps are smaller than, or comparable to, the
noise in the numbers that produced them.

And the column says this, in a section heading:

> **The direction is not fixed either.** FBCNet goes the other way: 67.57%
> offline against 65.55% online, a model that gets *worse* when a person is in
> the loop.

A gap of 2.02 against a standard error of 2.99. That sentence asserts a
direction the data does not carry — which is the exact thing this platform was
built to catch, committed by this platform, one cycle after building the
mechanism that was supposed to prevent it.

(Stated carefully: this is computed from the two reported SDs treating the
groups as independent. The paper may well have run a paired test with more
power, and I am not claiming it found nothing. The claim is narrower and
sufficient: **from the numbers this dataset serves, that gap does not support a
direction**, so a column built on this dataset must not assert one.)

### Why the mechanism did not catch it

Because a claim has no idea what an interval is. `tolerance:` looks like
uncertainty and is not: it is **how far the author will let the dataset drift
before flagging the sentence**, a statement about editorial patience. The
measurement's own dispersion is a different quantity and there is nowhere to
put it. Conflating the two is worse than omitting one, because a `± 15%`
sitting next to a number reads like error bars.

The gap this leaves is the same shape as the previous two cycles, which is
starting to look like the real pattern in this subject area:

- cycle 2: a number pooled over organisms, rendered as though it had one.
- cycle 3: a number produced by one pipeline, rendered as though it had none.
- cycle 4: a number with a distribution behind it, rendered as a point.

Each time, the platform displayed a summary and silently discarded the thing
that says how much to trust it.

### Building this cycle

- The node serves **dispersion** alongside the value, wherever the dataset has
  it, and drops it where it does not rather than substituting zero.
- **`select: dispersion`** — a claim asserting the spread the dataset reports,
  so the uncertainty is checkable on the same terms as the value.
- **The chip shows it.** A value with a known dispersion renders as
  `59.45 ± 3.33 %`, not `59.45 %`, because the honest rendering of a
  distribution is not its centre.
- The decoder column is rewritten to say what the numbers support. The honest
  version is a better column than the one it replaces: the paper's headline is
  that rankings reorder between protocols, and at n = 4 exactly one of ten gaps
  is larger than its own noise.

---

## 2026-09-12 (cycle 4, Layer 2) — I measured zkLogin in a browser, and it is not close

Layer 1 (blind-signed access tokens) shipped and is verified. Layer 2 — a
zero-knowledge proof that the client holds a valid Google-signed JWT, so the
platform never sees the Google identity at all — was specified as the next
thing, with four questions to answer explicitly: browser proving time, what the
user sees while it runs, Google key rotation, a fallback, and the size of the
cryptographic dependency.

Two of those turned out to answer the rest.

### What the zkLogin paper says

Baldimtsi et al., *zkLogin: Privacy-Preserving Blockchain Authentication with
Existing Credentials* (arXiv:2401.11735):

- **"In total, our R1CS circuit has around 1.1 million (slightly above 2^20)
  constraints."** Broken down: SHA-2 is "around 750k (66%)", RSA bignum
  operations "around 155k (14%)", JWT parsing "approximately 235k (20%)". The
  expensive 80% is verifying Google's RS256 signature, and it is irreducible —
  you cannot check a signature without doing the arithmetic.
- **"The average proof generation time is 2.1 ± 0.15 s"** — using **rapidsnark**,
  a native prover, on a **Google Cloud n2d-standard-16: 16 vCPUs, 64 GB RAM.**
- And, decisively: **"proving moderately complex ZKPs (e.g., around 1M
  constraints in Groth16) can lead to crashes or long delays on a browser"** —
  which is why Sui's production zkLogin delegates proving to a backend ZK
  service.

That last point is the thing. A proving service is a party that sees the JWT.
For Sui that is tolerable because the verifier is a blockchain and the ZK
service is a different party. Here the platform *is* the verifier, so any
prover we run is us, and the sever we were trying to create does not exist.

### What I measured, rather than took on faith

Built a tunable circom circuit (one squaring per constraint), ran the full
Groth16 pipeline, and proved **in Chrome with snarkjs** — the same WASM prover a
browser would actually use — on this machine: **16 cores, 16 GB.**

| constraints | zkey | prove (best of 2, in-browser) |
| ---: | ---: | ---: |
| 1,000 | 475 KB | 87 ms |
| 5,000 | 2.57 MB | 246 ms |
| 20,000 | 10.26 MB | 779 ms |
| 30,000 | 14.34 MB | 1,057 ms |

**The proving key is exactly linear: ~478–513 bytes per constraint** across the
whole range. At zkLogin's 1.1M constraints that is **~530–560 MB** of proving
key, which the browser must download and hold in memory before it can prove
anything. That extrapolation is safe because the relationship is linear and
measured over a 30× range, and it settles the question on its own: no reading
site asks a subscriber to fetch half a gigabyte to sign in.

**The proving time I will not extrapolate, and it is worth saying why.** Fitting
a power law to these four points gives an exponent of 0.815 — *sublinear*, which
is impossible for Groth16 (it is Θ(n log n)). The artefact is fixed overhead:
decomposing the two largest points gives ~223 ms of constant cost plus
0.0278 ms per constraint. A straight-line extrapolation of the marginal term
gives ~31 s at 1.1M constraints, and that is a **floor**, not an estimate —
it ignores the log factor and, more importantly, ignores that the multi-scalar
multiplication working set at 1.1M constraints is measured in gigabytes on a
16 GB machine. That is where the paper's "crashes" come from.

So the honest statement is: **≥ 31 s and ~550 MB on a 16-core desktop, with the
real figure higher and the failure mode being an out-of-memory crash rather
than a slow success.** A four-year-old phone is not in the conversation.

### The decision

**Layer 2 is not built, and no partial version of it is shipped.** A proof that
is not a proof, or a circuit without a real trusted setup, would be worse than
nothing here — it is precisely the overclaiming that Layer 1's own privacy page
argues against. The reasoning is recorded in docs/CONTRACTS.md and the status is
stated on `/privacy`, where a reader making a decision will see it rather than
in a document they will not read.

Answering the four questions as asked, since the answers are the argument:

- **Browser proving time** — ≥ 31 s measured floor, realistically minutes or a
  crash. Not viable.
- **What the user sees while it runs** — moot, but worth recording: there is no
  acceptable answer. A thirty-second-plus blocking wait on sign-in, on a
  publication people open once and read, is worse than the exposure it removes.
- **Google key rotation** — solvable and not the blocker. The paper's approach
  is an oracle polling the JWKS endpoint and treating every key seen in the last
  Δ epochs as current, which is structurally the same trick as this platform's
  own two-live-epoch token keys.
- **Fallback if proving fails or the device is too slow** — would be the current
  sign-in plus Layer 1, which is to say: the fallback is the whole product, and
  a feature whose fallback is "everything, for nearly everyone" is not a
  feature.
- **Size of the dependency** — snarkjs is 9.7 MB unpacked, which is the small
  part. The circuit artefacts are the dependency: ~550 MB of proving key per
  circuit version, plus a trusted setup ceremony whose integrity everything
  rests on.

### What shipped instead, and what it is not

One genuine reduction, in the same direction, that needed no proof: **the
platform stopped asking Google for the `email` scope.** It never used the
address — the subject is an HMAC of the account id, the greeting uses the
display name — but it asked anyway, so Google sent it and it sat in server
memory for the length of a request. Not asking is strictly better than asking
and forgetting: there is now no version of the flow in which an address is in
this process at all. The local OAuth stand-in was changed to match, because a
stand-in that answers more richly than the real provider lets code grow a
dependency on a field production will not have.

This is **not** Layer 2 and is not described as such anywhere. Layer 2 severs
the platform from the Google identity; this narrows what the platform is handed
alongside it. The `sub` still passes through server memory at sign-in, and only
a proof would change that.


### Built (same cycle)

All four, plus the correction. The node serves `dispersion`, `dispersionKind`
and `nObservations` where a dataset reports them and null where it does not;
`select: dispersion` makes the spread assertable on the same terms as the
value; a value renders as `59.45 ± 3.33 %`; and the decoder column was rewritten
to say what the numbers support.

The rewrite is the part worth recording. The old section heading was "The
direction is not fixed either" and it asserted FBCNet gets worse online from a
gap of 2.02 against a standard error of 2.99. The new one is "Nine of the ten
gaps are smaller than their own noise", carries the whole table, and states the
narrow claim: from the numbers this dataset serves, nine of those gaps do not
support a direction. It is a better column than the one it replaces, which is
the second time this cycle that being forced into honesty produced the stronger
piece of writing.

Caught before serving by `cephroom check`, which had not existed a day earlier.
