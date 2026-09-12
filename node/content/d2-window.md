---
slug: d2-occupancy-window
title: The D2 window is a fact about patients, not about molecules
subtitle: Affinity and occupancy get used interchangeably. They are not the same measurement, and the gap between them is where most antipsychotic folklore lives.
tags: neuropharmacology, receptors, binding-affinity, chembl
access: public
author: elena
repo: https://github.com/juitindev/d2-occupancy-window
commit: 9f2c1ab
---

Every introduction to antipsychotic pharmacology arrives at the same
sentence within two paragraphs: clinical response needs roughly 65% striatal
D2 occupancy, and extrapyramidal side effects begin somewhere above 80%. It
is one of the most reproduced numbers in psychiatry. It is also routinely
attached to the wrong noun.

Occupancy is a property of a dose in a person. Affinity is a property of a
molecule against a receptor preparation. You can move from one to the other
only with a pharmacokinetic model, a free-fraction estimate, and a set of
assumptions about brain penetration that the binding assay knows nothing
about. The number that a binding experiment gives you is this:

Haloperidol binds the human D2 receptor with a median Ki of
{{claim:hal-d2}}, pooled across {{claim:hal-d2-docs}} independent
publications.

```claim hal-d2
dataset: receptorome-ki
metric: median_ki_nm
subject: DRD2
object: haloperidol
scope: all
value: 1.549 nM
tolerance: 10%
```

```claim hal-d2-docs
dataset: receptorome-ki
metric: median_ki_nm
subject: DRD2
object: haloperidol
scope: all
select: n_docs
value: 93
tolerance: 5%
```

That is a tight number with a lot of evidence behind it, and it tells you
almost nothing about what dose to give. It tells you about the receptor.

## The comparison that does survive

What binding data is good for is *relative* statements within a consistent
assay context. Take clozapine, the drug the occupancy window least
describes:

| Compound | D2 median Ki | Distinct papers |
| --- | --- | --- |
| Haloperidol | {{claim:hal-d2}} | {{claim:hal-d2-docs}} |
| Clozapine | {{claim:cloz-d2}} | {{claim:cloz-d2-docs}} |

```claim cloz-d2
dataset: receptorome-ki
metric: median_ki_nm
subject: DRD2
object: clozapine
scope: all
value: 104.1 nM
tolerance: 10%
```

```claim cloz-d2-docs
dataset: receptorome-ki
metric: median_ki_nm
subject: DRD2
object: clozapine
scope: all
select: n_docs
value: 67
tolerance: 5%
```

Roughly a sixty-seven-fold difference in affinity, and yet both drugs are
antipsychotic. Clozapine, at clinically effective doses, sits well below the
supposed 65% threshold — usually reported in the 20–47% range. Either the
threshold is wrong, or it is a statement about a particular class of drug
rather than about antipsychotic action in general.

The second reading is the defensible one, and it is the reason the window
keeps producing confused predictions when it is applied to compounds outside
the class it was derived from.

## What the number is actually made of

The median above is not a measurement. It is a summary of measurements taken
in different laboratories, with different radioligands, in different
preparations, across four decades. The spread within that cell is wide: the
loosest and tightest values differ by {{claim:cloz-d2-fold}}, while across the
middle half of the measurements the disagreement is only {{claim:cloz-d2-iqr}}.
That spread is real disagreement between labs, not the artefact of a detection
limit: only {{claim:cloz-d2-censored}} of the measurements is a censored
ceiling rather than a true value. And it is not a ChEMBL idiosyncrasy either —
the independent PDSP Ki Database puts the same clozapine–D2 median within
{{claim:cloz-d2-pdsp}} of this one.

```claim cloz-d2-pdsp
dataset: receptorome-ki
metric: median_ki_nm
subject: DRD2
object: clozapine
scope: all
select: pdsp_fold
value: 1.33x
tolerance: 20%
```

```claim cloz-d2-censored
dataset: receptorome-ki
metric: median_ki_nm
subject: DRD2
object: clozapine
scope: all
select: censored_fraction
value: 1.2%
tolerance: 25%
```

```claim cloz-d2-fold
dataset: receptorome-ki
metric: median_ki_nm
subject: DRD2
object: clozapine
scope: all
select: fold_spread
value: 140.6x
tolerance: 15%
```

```claim cloz-d2-iqr
dataset: receptorome-ki
metric: median_ki_nm
subject: DRD2
object: clozapine
scope: all
select: fold_spread_iqr
value: 5.07x
tolerance: 15%
```

That distinction matters more than the median does. A cell with a huge total
spread but a tight interquartile range is a well-determined value with an
outlier in it. A cell where both are wide is genuinely unresolved. Reporting
only the median hides which situation you are in — which is why these two
numbers are themselves checkable claims, and not a sentence I asked you to
take on faith.

## The honest version of the sentence

> Between roughly 65% and 80% striatal D2 occupancy, *for typical
> antipsychotics dosed at steady state*, clinical response is common and
> extrapyramidal symptoms are not yet. Outside that drug class the window has
> not been shown to hold.

Less quotable. Considerably harder to misuse.
