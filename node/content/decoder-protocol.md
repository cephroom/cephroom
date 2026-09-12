---
slug: which-protocol-produced-that-number
title: A decoding accuracy is not a property of a decoder
subtitle: Ten models, two evaluation protocols, one reordering. The number you quote depends on how it was produced, and most papers report only one of the two.
access: public
author: marcus
repo: https://github.com/cephroom/decoder-protocol
commit: 4b1c09e
---

Somebody tells you a motor-imagery decoder gets 59.5%. Somebody else tells you
the same decoder gets 70.0%. Neither is lying, neither made an arithmetic
error, and the difference is not noise.

EEG-TCNet, evaluated by replaying recorded data, scores
{{claim:tcnet-offline}}. The same decoder, on the same four-class task, driving
a live closed loop with a person in it, scores {{claim:tcnet-online}}. Ten and
a half points, and the two numbers are separated by nothing except the protocol
that produced them — a spread of {{claim:tcnet-spread}} between the analyses of
one model.

```claim tcnet-offline
dataset: mi-decoders-2025
metric: accuracy_pct
subject: EEG-TCNet
object: four-class-motor-imagery
method: offline
value: 59.45 %
tolerance: 2%
```

```claim tcnet-online
dataset: mi-decoders-2025
metric: accuracy_pct
subject: EEG-TCNet
object: four-class-motor-imagery
method: online
value: 70.0 %
tolerance: 2%
```

```claim tcnet-spread
dataset: mi-decoders-2025
metric: accuracy_pct
subject: EEG-TCNet
object: four-class-motor-imagery
select: method_spread
value: 1.18x
tolerance: 5%
```

## The direction is not fixed either

If this were a constant penalty for leaving the lab, you could subtract it and
move on. FBCNet goes the other way: {{claim:fbcnet-offline}} offline against
{{claim:fbcnet-online}} online, a model that gets *worse* when a person is in
the loop.

```claim fbcnet-offline
dataset: mi-decoders-2025
metric: accuracy_pct
subject: FBCNet
object: four-class-motor-imagery
method: offline
value: 67.57 %
tolerance: 2%
```

```claim fbcnet-online
dataset: mi-decoders-2025
metric: accuracy_pct
subject: FBCNet
object: four-class-motor-imagery
method: online
value: 65.55 %
tolerance: 2%
```

So there is no factor to divide out. This is the same shape as the species
problem in binding data, one level up: a difference with no consistent sign
cannot be corrected, only disclosed.

## What it does to a ranking

Offline, FBCNet ({{claim:fbcnet-offline}}) beats EEG-TCNet
({{claim:tcnet-offline}}) by eight points. Online, EEG-TCNet
({{claim:tcnet-online}}) beats FBCNet ({{claim:fbcnet-online}}) by four and a
half. The pair swaps.

A review sentence that says "FBCNet outperforms EEG-TCNet" is true, of one
protocol, and is not marked as such anywhere in the sentence. That is the
failure mode this platform exists to catch — except that until this dataset
existed, the platform could not have caught it either, because a fact here
carried no room for the analysis that produced it.

## The one number a claim cannot quietly get wrong

Write a claim against this dataset without a `method:` line and it does not
resolve. Not a warning, not a footnote, and not a silently pooled average of
64.7% that no experiment produced: it goes **broken**, and says which analyses
exist.

That is deliberate, and it is a decision taken from evidence rather than taste.
NeuroVault's collection schema has 107 fields, roughly sixty of which describe
the analysis pipeline — `software_package`, `smoothing_fwhm`,
`autocorrelation_model`, `group_inference_type` — added years before NARPS put
seventy teams on one dataset and found "the proportion of teams reporting a
significant effect ranged from 0% to 100%". On NARPS's own submitted maps, ten
of those 107 fields are filled, and none of them is an analysis field.

Optional provenance is not collected. A field nothing reads is a field nobody
fills. The only version that survives contact with a deadline is the one where
the number does not come out without it.

## What this dataset is not

Four participants. Twenty decoders, ten of which were run under one protocol
only and therefore carry no online number at all rather than an imputed one.
Every value transcribed from a single paper and none computed here.

It is an illustration of protocol sensitivity, not a leaderboard, and the
`method:` line on every claim above is what stops it being read as one.
