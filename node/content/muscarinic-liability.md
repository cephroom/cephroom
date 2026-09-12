---
slug: muscarinic-liability-is-a-clozapine-problem
title: Muscarinic liability is mostly a clozapine problem
subtitle: The anticholinergic burden of second-generation antipsychotics is discussed as a class property. In binding terms it is almost entirely two drugs.
tags: neuropharmacology, receptors, binding-affinity
access: member
author: marcus
repo: https://github.com/juitindev/muscarinic-burden
commit: 88a4e2f
---

Anticholinergic burden scales — ACB, ADS, and their relatives — assign
antipsychotics a class-level score and use it to predict cognitive decline
in older patients. The scales are clinically useful. They are also a very
lossy summary of what the receptor data says.

## The M1 column

Ranked by M1 affinity, the eight drugs do not form a gradient. They form two
groups with two orders of magnitude between them.

Clozapine binds M1 at {{claim:cloz-m1}} — comparable to its affinity at
histamine H1, and tighter than its affinity at D2 by a factor of roughly
fifty. Olanzapine follows at {{claim:olz-m1}}.

```claim cloz-m1
dataset: receptorome-ki
metric: median_ki_nm
subject: CHRM1
object: clozapine
scope: all
value: 2.11 nM
tolerance: 15%
```

```claim olz-m1
dataset: receptorome-ki
metric: median_ki_nm
subject: CHRM1
object: olanzapine
scope: all
value: 6.856 nM
tolerance: 15%
```

Then the floor drops out. Chlorpromazine sits at {{claim:cpz-m1}} —
twenty-five-fold weaker than olanzapine. Quetiapine is weaker still at
{{claim:que-m1}}. Risperidone, haloperidol and ziprasidone are in the
micromolar range, which at clinical exposures is not meaningful occupancy at
all.

```claim cpz-m1
dataset: receptorome-ki
metric: median_ki_nm
subject: CHRM1
object: chlorpromazine
scope: all
value: 50.18 nM
tolerance: 20%
```

```claim que-m1
dataset: receptorome-ki
metric: median_ki_nm
subject: CHRM1
object: quetiapine
scope: all
value: 398.1 nM
tolerance: 20%
```

## What the class-level score hides

A patient on risperidone and a patient on clozapine are not on the same
anticholinergic trajectory in any sense the binding data supports. Treating
"second-generation antipsychotic" as the unit of analysis merges a drug with
single-digit nanomolar M1 affinity into the same bucket as one with none.

There is a real caveat, and it runs the other way. Quetiapine's active
metabolite norquetiapine has substantially different muscarinic pharmacology
from the parent compound, and a parent-compound binding table cannot see
that. Matrices like this one are about the molecule that was assayed, not
about what circulates in a patient.

## The evidence underneath

The M1 row is thin. Clozapine's value rests on {{claim:cloz-m1-docs}}
distinct publications; several other cells in the row rest on one or two.
Chlorpromazine's M1 cell in particular has only two documents behind it, and
its confirmed-human subset is a single measurement.

```claim cloz-m1-docs
dataset: receptorome-ki
metric: median_ki_nm
subject: CHRM1
object: clozapine
scope: all
select: n_docs
value: 6
tolerance: 5%
```

This is the honest shape of the argument: the large separations at the top
of the column are robust, and the ordering among the weak binders at the
bottom is not. A ranking is only as good as its thinnest cell, and this one
has cells with an *n* of one.
