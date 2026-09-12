---
slug: three-empty-cells
title: Three empty cells
subtitle: A coverage number is a claim about what you know. Most published affinity matrices report one number and quietly imputes the rest.
tags: neuropharmacology, data-quality, chembl
author: marcus
repo: https://github.com/juitindev/coverage-ladder
commit: c07f1d3
---

Build a grid of ten aminergic receptors against eight antipsychotics and you
get eighty cells. Ask how many are populated and the honest answer is not one
number. It is four, and they mean different things.

- **77 of 80** have *any* measurement at all, censored values included.
- **73 of 80** have at least one uncensored point estimate.
- **70 of 80** have a point estimate from an assay confirmed to use human
  receptor, with the target assigned directly rather than to a family.
- **70 of 80** also have an assay format indicating a cloned preparation.

Each line is a strictly stronger claim than the one above it. Which one you
quote depends entirely on what you intend to do next. If you are comparing
against human receptor structures, the 96% at the top is not your number —
88% is.

## Censored is not missing

Four cells have only censored measurements: results reported as `>10000 nM`
or similar. A great deal of published analysis treats these as empty. They
are not empty. `>10000 nM` is a measurement, and for the problem of working
out which targets a compound *does not* hit, it is a true negative — the
most useful kind of data point there is.

Evaluating a target-deconvolution method without negatives is close to
meaningless. You can score perfectly by predicting that everything binds
everything. The four censored-only cells here are counted separately
throughout, never folded into the empty count and never silently promoted to
point estimates.

## Three cells with nothing

That leaves three cells with no data of any kind. Two of them involve
CHRM3, which is measured far less often than the M1 subtype it is usually
grouped with; the third is chlorpromazine at ADRA1A, where the alpha-1
literature reports on the receptor family rather than the 1A subtype.

The temptation here is enormous. You have a nearly complete matrix and three
holes in it, and every imputation method you know will happily fill them.
Family-level data exists. Rodent data exists. A structural analogue exists.

None of it goes in. A cell filled by inference is not the same kind of object
as a cell filled by measurement, and once they share a table nobody
downstream can tell them apart. The three cells stay empty and get listed by
name.

## What this costs

It costs you the ability to say "96% coverage" in an abstract. It buys you
the ability to have every number in the matrix mean exactly one thing.

For comparison, here is what full coverage actually looks like when it is
real. Clozapine against D2 is one of the best-evidenced cells in the grid:
{{claim:cloz-d2-n}} separate point estimates drawn from
{{claim:cloz-d2-docs}} distinct publications.

```claim cloz-d2-n
dataset: receptorome-ki
metric: median_ki_nm
subject: DRD2
object: clozapine
scope: all
select: n_points
value: 80
tolerance: 5%
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

Compare that to ziprasidone at 5-HT2B, which rests on a single measurement
from a single paper. Both appear in the matrix as one number each. Only one
of them should be load-bearing in an argument, and you cannot tell which
from the number alone.

That is why every claim on Cephroom carries its evidence count. A value
without an *n* is a rumour with a decimal point.
