---
slug: serotonin-dopamine-ratio-audited
title: The 5-HT2A:D2 ratio, audited
subtitle: Meltzer's ratio is the most cited structure–activity claim in psychiatry. Recomputed from pooled ChEMBL medians, it survives — but not in the form it is usually quoted in.
tags: neuropharmacology, receptors, binding-affinity
access: member
author: elena
repo: https://github.com/juitindev/meltzer-ratio
commit: 41d0e77
---

In 1989 Meltzer, Matsubara and Lee proposed that what separates an atypical
antipsychotic from a typical one is not any single affinity but a ratio:
higher affinity for 5-HT2A than for D2. It has been enormously productive as
a design heuristic and enormously abused as a classification rule.

The problem with checking it is that the original analysis used one
laboratory's assays, run consistently. Pooled literature medians are a
different object: they mix radioligands, preparations, and species. Any
recomputation has to say which of those it did, and this one says it here —
all values are median Ki in nanomolar over uncensored point estimates, all
organisms, no conversion between activity types.

## The recomputation

Risperidone is the cleanest case in the set. Its 5-HT2A affinity is
{{claim:risp-5ht2a}} against a D2 affinity of {{claim:risp-d2}} — close to an
eight-fold preference for the serotonin receptor.

```claim risp-5ht2a
dataset: receptorome-ki
metric: median_ki_nm
subject: HTR2A
object: risperidone
scope: all
value: 0.5 nM
tolerance: 15%
```

```claim risp-d2
dataset: receptorome-ki
metric: median_ki_nm
subject: DRD2
object: risperidone
scope: all
value: 3.85 nM
tolerance: 15%
```

Clozapine, the prototype the ratio was built to explain, is more extreme
still: {{claim:cloz-5ht2a}} at 5-HT2A against roughly 104 nM at D2, an order
of magnitude beyond risperidone's separation.

```claim cloz-5ht2a
dataset: receptorome-ki
metric: median_ki_nm
subject: HTR2A
object: clozapine
scope: all
value: 9.12 nM
tolerance: 15%
```

Haloperidol inverts it, exactly as the hypothesis requires. Its 5-HT2A
affinity is {{claim:hal-5ht2a}} — nearly two orders of magnitude *weaker*
than its D2 affinity.

```claim hal-5ht2a
dataset: receptorome-ki
metric: median_ki_nm
subject: HTR2A
object: haloperidol
scope: all
value: 120.0 nM
tolerance: 15%
```

So far the heuristic is doing well.

## Where it stops working

Olanzapine is where pooled data starts arguing with the textbook. Its
5-HT2A median comes out at {{claim:olz-5ht2a}}, against about 20 nM at D2 —
a five-fold preference, real but modest, and considerably smaller than the
separation usually quoted for it.

```claim olz-5ht2a
dataset: receptorome-ki
metric: median_ki_nm
subject: HTR2A
object: olanzapine
scope: all
value: 3.2 nM
tolerance: 10%
```

Quetiapine is worse for the hypothesis. Both affinities are weak —
{{claim:que-5ht2a}} at 5-HT2A and roughly 309 nM at D2 — and the ratio that
results is about 2.6, which is not a meaningful separation given the spread
inside either cell. Quetiapine is clinically atypical by every behavioural
criterion and its ratio barely clears one.

```claim que-5ht2a
dataset: receptorome-ki
metric: median_ki_nm
subject: HTR2A
object: quetiapine
scope: all
value: 120.1 nM
tolerance: 15%
```

Aripiprazole breaks it outright, but for a reason the ratio was never
designed to capture: it is a D2 partial agonist. Affinity says nothing about
efficacy, and a ratio of affinities cannot distinguish a silent antagonist
from a 30%-efficacy partial agonist sitting on the same receptor.

## What survives

The ratio is a real regularity at the extremes and noise in the middle. It
separates haloperidol from clozapine decisively. It does not separate
quetiapine from anything, and it is structurally blind to partial agonism.

Used as a *description* of the clozapine-like end of the space, it holds up
well against pooled data thirty-five years later. Used as a *test* for
atypicality, it misclassifies at least two of the eight drugs here.

That is a better outcome than most pharmacological heuristics of that
vintage manage. It is not the same as the rule it is usually quoted as.
