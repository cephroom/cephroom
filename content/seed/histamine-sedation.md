---
slug: histamine-h1-and-the-sedation-question
title: H1 affinity predicts sedation better than any of us would like
subtitle: A crude single-receptor story explains more of the observed sedation ranking than the multi-receptor models that replaced it.
access: lab
author: elena
repo: https://github.com/bindery-science/h1-sedation
commit: 1a9de50
---

Sedation is the side effect patients discontinue over, and it has resisted
elegant explanation for thirty years. The multi-receptor account — H1 plus
alpha-1 plus M1 plus 5-HT2C, weighted by exposure — is almost certainly
closer to the truth. It is also not obviously better at ranking the drugs
than the crude version.

## The crude version

Rank by H1 affinity alone.

| Compound | H1 median Ki |
| --- | --- |
| Clozapine | {{claim:cloz-h1}} |
| Chlorpromazine | {{claim:cpz-h1}} |
| Olanzapine | {{claim:olz-h1}} |
| Quetiapine | {{claim:que-h1}} |
| Risperidone | {{claim:risp-h1}} |
| Aripiprazole | {{claim:ari-h1}} |
| Ziprasidone | {{claim:zip-h1}} |
| Haloperidol | {{claim:hal-h1}} |

```claim cloz-h1
dataset: receptorome-ki
metric: median_ki_nm
subject: HRH1
object: clozapine
scope: all
value: 1.8 nM
tolerance: 15%
```

```claim cpz-h1
dataset: receptorome-ki
metric: median_ki_nm
subject: HRH1
object: chlorpromazine
scope: all
value: 2.884 nM
tolerance: 15%
```

```claim olz-h1
dataset: receptorome-ki
metric: median_ki_nm
subject: HRH1
object: olanzapine
scope: all
value: 3.13 nM
tolerance: 15%
```

```claim que-h1
dataset: receptorome-ki
metric: median_ki_nm
subject: HRH1
object: quetiapine
scope: all
value: 10.0 nM
tolerance: 15%
```

```claim risp-h1
dataset: receptorome-ki
metric: median_ki_nm
subject: HRH1
object: risperidone
scope: all
value: 25.53 nM
tolerance: 15%
```

```claim ari-h1
dataset: receptorome-ki
metric: median_ki_nm
subject: HRH1
object: aripiprazole
scope: all
value: 37.0 nM
tolerance: 15%
```

```claim zip-h1
dataset: receptorome-ki
metric: median_ki_nm
subject: HRH1
object: ziprasidone
scope: all
value: 47.0 nM
tolerance: 15%
```

```claim hal-h1
dataset: receptorome-ki
metric: median_ki_nm
subject: HRH1
object: haloperidol
scope: all
value: 440.0 nM
tolerance: 15%
```

That ordering is, with one inversion, the clinical sedation ranking. The
inversion is quetiapine, which is more sedating than its H1 affinity alone
predicts — and which has an active metabolite and a very different exposure
profile from the rest of the list.

## Why this is uncomfortable

A single-receptor model that recovers seven of eight positions is not
evidence that sedation is an H1 phenomenon. It is evidence that H1 affinity
is strongly correlated with whatever actually drives it, which in this
chemical series it plainly is: the tricyclic dibenzodiazepines that bind H1
tightly also bind alpha-1 and M1 tightly, because that is what that scaffold
does.

The multi-receptor model is more mechanistically honest and adds essentially
no rank-ordering power over a set of eight compounds that co-vary this
heavily. You would need a series that dissociates H1 from alpha-1 to
distinguish the two accounts, and this series does not contain one.

## The methodological point

This is what a strongly co-varying descriptor set looks like, and it is the
standard failure mode of receptor-profile arguments. Eight compounds, ten
receptors, and most of the columns correlated with each other. Any model you
fit will look good and none of them are identified.

The fix is not a better model. It is a compound series chosen to break the
correlation — which means the interesting experiment is a sourcing problem,
not a statistics problem.
