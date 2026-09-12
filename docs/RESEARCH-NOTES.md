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
