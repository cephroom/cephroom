# Research notes

What actual scientific practice tells us researchers need from a platform
like this, and how each need maps to the product. Grounded where possible in
the vendored receptorome pipeline's own verification record
(`C:\dev\receptorome\docs\VERIFICATION.md`, ChEMBL_37, verified 2026-08-06),
which is a primary source for how binding data behaves in practice.

Each cycle adds to this. Entries are dated.

---

## 2026-09-12 — Provenance is the product, not a footnote

### What the data actually does

The receptorome verification doc is a catalogue of ways a number betrays you:

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
