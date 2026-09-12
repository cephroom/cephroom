# Competitive notes

Concrete observations from visiting real products, and — as importantly —
which patterns this product must **reject** because of the three contracts.
A rejected pattern with its reason is as valuable as an adopted one.

Visited as a reader only. Attack scope stays on the local dev server.

---

## 2026-09-12 — GitHub (github.com/about) and Zenodo (zenodo.org)

### GitHub — the archetype for Contract 1

Observed on the About page: the entire pitch is scale-of-network —
"225M+ developers, 800M+ repositories." The value proposition is *the graph*:
who forked what, who reviewed what, whose work builds on whose.

- **Adopt (the thesis):** GitHub's worth is not storage, it is that every
  change is attributable, diffable, reviewable. Our claim + proposal loop is
  the scientific translation and must stay the spine of the product. When a
  change would make us "a nicer blog," this page is the reminder of what we
  are instead.
- **Reject (the profile graph):** GitHub is built entirely on persistent user
  profiles — followers, contribution graphs, stars, org membership. Every one
  of those is a stored personal record. Contract 2 forbids all of it. We get
  attribution (pseudonymous subject, self-declared display name in a live
  announcement) without the profile. **No follower counts, no contribution
  calendars, no "trending contributors," no stars.** These would each require
  a user table. Recorded so they are never mistaken for obvious wins.
- **Reject (the archive):** every GitHub repo is permanent and cached on their
  servers. Contract 3 forbids that. Our discovery is presence-only. A reader
  arriving at a dormant column gets an honest "nobody is serving this," not a
  cached snapshot. This is the sharpest divergence and must not erode.

### Zenodo — the anti-pattern that clarifies our contracts

Zenodo is a research-data repository run by CERN. Its "Why use Zenodo?"
section is almost a point-by-point inversion of our architecture, which makes
it the most useful thing I looked at:

| Zenodo promises | Our stance |
| --- | --- |
| "Safe — stored for as long as CERN exists" | We store nothing. Persistence is the contributor's, not ours. Opposite by design. |
| "Citeable — every upload gets a DOI" | A DOI is a permanent identifier backed by permanent storage. We cannot mint one; our identifier is `sub/slug` and resolves only while served. **This is a real gap for researchers** (citability) and an honest cost of Contract 3 — recorded below. |
| "Versioning — update your dataset" ("1354 more versions exist") | Version history is client/author-side here; the platform holds no version chain. |
| "Usage statistics on all uploads" | Download counts are an activity record about people. Contract 2 forbids them outright. **No view counts, no download stats, no trending.** |
| "Restricted access mode" | We have this — member/lab gating — but enforced by the *node* verifying a signed key, not by a central ACL table. |

**The citability gap is the one worth sitting with.** Researchers need a
stable, resolvable identifier to cite (Zenodo's whole pitch is the DOI).
Contract 3 means a `cephroom.example/read/<sub>/<slug>` link resolves only
while the author serves it — uncitable in the DOI sense. We cannot fix this
by caching (that breaks Contract 3). The honest framing, already in the
product's copy, is that this is a *live reading surface*, not an archive. But
a later cycle should consider whether a content-addressed identifier (a hash
of the column bytes) could let a reader verify they are reading the same
bytes a citation referred to, even served by a different node — continuity
without the platform storing anything. That would be genuinely novel and
contract-clean. Noted for the research/extend steps, not built yet.

### Loading / empty-state / onboarding observations

- **Zenodo's landing is a live feed** of recent uploads with version counts
  and two engagement numbers per item. We deliberately cannot show the
  engagement numbers (activity records). Our `/read` "reading now" feed is the
  contract-clean equivalent: live, but of *presence* not *popularity*.
- **Neither product's cold empty-state was observable** (both are always
  populated at scale). Ours genuinely can be empty, and the honest "Nobody is
  serving anything — Cephroom has no archive" state is a feature of the
  model, not a failure. Confirmed it reads as intentional in the role walk.
- **GitHub onboarding** funnels hard to account creation. Ours must not: there
  is no account. The nearest equivalent — "get a key" — is framed as exactly
  that on `/signin`, and serving needs no account at all.

### Net: patterns adopted vs rejected this visit

- Adopt: attribution-and-diff as the spine; live feed of what exists now.
- Reject (each would need a user table or an archive): profiles, followers,
  stars, contribution graphs, view/download stats, trending, DOIs backed by
  central storage, permanent cached repos.
- Open question for later cycles: content-addressed identifiers for
  cite-time verification without storage.

## Visit: Our World in Data, read as a reader (2026-09-12)

Read the Life expectancy chart page, ourworldindata.org/grapher/life-expectancy.
This is the closest live analog to the whole product: prose and a chart whose
truth depends on data that keeps moving. What they do about that is the point.

Observed on the page itself:

- **A freshness contract, stated inline.** Under the chart:
  "Last updated 2025-10-22 · Next expected update 2026-10-22". They do not
  just timestamp the data; they *promise a next refresh date* and name the
  steward ("Managed by …"). The data is treated as living, on a published
  cadence.
- **Sources and licence ride with the chart**, not in a footnotes page:
  "Data source: Riley (2005); Zijdeman et al. (2015); HMD (2025); UN WPP
  (2024) — with major processing by Our World in Data … CC BY". Provenance
  includes *how much processing* sits between source and number.
- **The same data in several shapes** — Table / Map / Line / Bar toggles over
  one dataset — plus Download (the underlying numbers) and a stable citable
  URL.

### Adopt

- **Say when the data was made, next to the number.** Our claim-check header
  shows the dataset release (`@ChEMBL_37`) but not *when* that release was
  generated. The node already carries `generatedAt`; surfacing it as a
  "dataset generated YYYY-MM-DD" line would make the freshness of a verified
  claim legible the way OWID's "last updated" does — without promising a next
  update we do not control.
- **One dataset, more than one shape.** The matrix is table-only. OWID's
  Table/Line/Bar toggle is a reminder that a reader compares cells better
  with a second representation. A later cycle: a per-target or per-compound
  view of the same facts, still node-served.

### Reject (the contracts forbid the mechanism, not the goal)

- **The "next expected update" promise.** It requires the platform to own the
  update pipeline and the archive behind the URL. Contract 2 puts the data on
  the contributor's machine; we cannot promise a refresh we do not run. Our
  answer to staleness is the opposite shape: not a promised future refresh,
  but a re-check that runs in the reader's browser *every* read. OWID keeps
  the number current and dates it; we keep the *claim* honest and flag it the
  instant the data moves.
- **The stable, always-available citable URL.** OWID's page is the sharpest
  illustration of what Contract 3 costs us: their URL is permanent and always
  answers because they store everything centrally. Ours stops answering the
  moment the contributor goes offline. This is the citability gap, already
  recorded honestly in CONTRACTS.md — OWID is the concrete thing a reader
  gives up in exchange for "no data at rest".

## Visit: IUPHAR/BPS Guide to PHARMACOLOGY and ChEMBL, read as a reader (2026-09-12, cycle 2)

Went looking for how professional pharmacology databases present the
*provenance* of a binding number — the question this cycle's research made
urgent. Found one cautionary tale and one adoptable pattern.

### GtoPdb — an open-access resource that grew a login wall

`guidetopharmacology.org` now redirects to `login.jsp` before it will show a
receptor page. The stated reason, verbatim on that screen:

> "The IUPHAR/BPS Guide to Pharmacology now requires all users to register and
> login in order to access the database. This change is necessary so that we
> can collect accurate user access data, which helps us maintain GtoPdb as an
> open-access, freely available resource."

This is worth recording carefully, because it is the most sympathetic possible
version of the thing our contracts forbid. GtoPdb is not a startup harvesting
emails — it is a curated public good, and it needs usage numbers to justify its
funding. The account exists to produce **analytics**, and the analytics exist to
keep it free.

- **Reject, and note what it costs.** Contract 1 forbids the user table and
  Contract 1's analytics row forbids the access log that would justify it. We
  cannot count our readers, so we can never make GtoPdb's argument to a funder.
  That is a real, non-hypothetical cost of the design and it belongs next to
  the citability gap rather than hidden.
- **The framing is the lesson.** "Register so we can stay open-access" is how a
  resource ends up with an identity database it never wanted. Ours is
  structurally unable to take that step, which is the point of enforcing the
  contract in tests rather than in a policy.
- Sharp irony worth keeping: GtoPdb is the *independent judge* the vendored
  pipeline checks its numbers against (36 known-value anchors). Our upstream
  source of truth is now behind a login. Nothing to fix here — the anchors were
  already extracted into the dataset — but it is a good argument for the
  PDSP cross-check shipping last cycle: a second independent judge matters when
  the first one can change its access terms.

### ChEMBL — the number is prominent, the provenance is three clicks away

Read the D(2) dopamine receptor target card (`CHEMBL217`) and its activity
charts.

**The misreading our whole cycle is about is right there in their header.**
The target card states, in the summary block near the top:

```
organism: Homo sapiens
Species Group: No
```

That is the **target's** organism — the protein was curated as the human gene
product. It says nothing whatsoever about where any experiment ran, and
rat-brain measurements sit under this exact header. `docs/VERIFICATION.md`
flags this as the trap that manufactures human provenance; seeing it rendered
as a clean two-word fact at the top of the page is a much stronger argument
than reading about it. A careful researcher clicks through to `/assay`. A
hurried one reads "Homo sapiens" and moves on.

- **Adopt the warning, not the pattern.** Any place we render a species word
  next to a value, it must be the *assay* organism, and it must be legible
  which one it is. This is the concrete reason the `organism_verdict` claim
  being built this cycle is worth a categorical select rather than a footnote.

**Adopt: show the composition of the evidence, not only the summary.**
Their "Activity Charts" section is genuinely good. Two pies:

- *Associated Bioactivities* — 32,602 points broken down by activity type:
  Ki, IC50, EC50, Kd, AC50, Inhibition, Emax, Kb, pKb, Ka, Ratio, T1/2, …
- *Associated Assays* — 2,481 assays by format: B-Binding, F-Functional,
  A-ADME, U-Unassigned.

Before you read a single number you can see that this target's data is a
*mixture of incompatible measurement types*, and roughly in what proportion.
That is exactly the honesty our "no conversion between activity types" rule
enforces in the pipeline — but we enforce it silently. A reader of our matrix
sees a clean Ki grid and has no idea it was carved out of a much larger,
heterogeneous pile.

- **What we should take:** the analogue for us is not activity type (we are
  Ki-only by construction) but **organism**. Every cell already carries
  `n_human` / `n_non_human` / `n_unknown_organism`. ChEMBL breaks its evidence
  down by type and *not at all by species*; that is the axis they leave open
  and the one that matters most for extrapolating to people. Surfacing the
  organism composition of a cell is a place we can be straightforwardly better
  than the upstream source, using data we already ship.

**Rejected on the same page:** "See all activities used in this plot (12611)
⚠ (Showing first 1000 data points out of 12611)" — a silent-ish truncation
that changes what the chart means, disclosed in small grey text under the
link. And one panel rendered `Error: Request failed with status code 500` in
red where a chart should be, with the rest of the page carrying on as normal.
Both are the failure mode our reader already avoids for the right reason: our
verification runs client-side over the facts the node actually served, so a
partial answer cannot masquerade as a whole one — there is no server-side
sampling step to under-disclose. Worth re-checking each cycle that our own
error states never degrade to a red string inside an otherwise-normal page.

### Net this visit

- Adopt: evidence *composition* shown alongside the summary statistic —
  applied to organism, which ChEMBL does not break down at all.
- Adopt (as a hard rule): a species word next to a value must be the assay
  organism, never the target's.
- Reject: accounts-for-analytics, however good the cause. Recorded with its
  real cost — we can never report a reader count to a funder.
