---
slug: which-protocol-produced-that-number
title: A decoding accuracy is not a property of a decoder
subtitle: Ten models, two evaluation protocols, one reordering. The number you quote depends on how it was produced, and most papers report only one of the two.
tags: eeg, bci, decoding, machine-learning, comparative-methods
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

## Nine of the ten gaps are smaller than their own noise

That is one decoder. Here is the table the paper reports, and the reason this
column nearly said something false.

Every value in this dataset carries a standard deviation over four
participants. EEG-TCNet's protocol gap is {{claim:tcnet-spread}}, against
standard deviations of {{claim:tcnet-offline-sd}} offline and
{{claim:tcnet-online-sd}} online — a difference comfortably larger than the
spread behind it.

```claim tcnet-offline-sd
dataset: mi-decoders-2025
metric: accuracy_pct
subject: EEG-TCNet
object: four-class-motor-imagery
method: offline
select: dispersion
value: 3.33 %
tolerance: 5%
```

```claim tcnet-online-sd
dataset: mi-decoders-2025
metric: accuracy_pct
subject: EEG-TCNet
object: four-class-motor-imagery
method: online
select: dispersion
value: 5.29 %
tolerance: 5%
```

**FBCNet is the opposite case, and an earlier version of this column got it
wrong.** It scores {{claim:fbcnet-offline}} offline and {{claim:fbcnet-online}}
online — a gap of about two points — with standard deviations of
{{claim:fbcnet-offline-sd}} and {{claim:fbcnet-online-sd}}. At four
participants that difference is well inside the noise, and the sentence that
used to be here said FBCNet "gets *worse* when a person is in the loop",
asserting a direction from a gap of 2.02 against a standard error of 2.99.

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

```claim fbcnet-offline-sd
dataset: mi-decoders-2025
metric: accuracy_pct
subject: FBCNet
object: four-class-motor-imagery
method: offline
select: dispersion
value: 1.07 %
tolerance: 5%
```

```claim fbcnet-online-sd
dataset: mi-decoders-2025
metric: accuracy_pct
subject: FBCNet
object: four-class-motor-imagery
method: online
select: dispersion
value: 5.88 %
tolerance: 5%
```

Worked through all ten decoders the paper ran under both protocols, taking the
standard error of the difference from the two reported deviations:

| decoder | online − offline | SE of difference | ratio |
| --- | ---: | ---: | ---: |
| EEG-TCNet | +10.55 | 3.13 | **3.38** |
| EEGNet | +7.90 | 4.30 | 1.84 |
| Shallow FBCSP Net | +6.89 | 4.53 | 1.52 |
| EEG Conformer | +6.65 | 3.53 | 1.88 |
| MSVTNet | +4.22 | 3.93 | 1.07 |
| SCCNet | +3.24 | 2.91 | 1.11 |
| FBCNet | −2.02 | 2.99 | 0.68 |
| Attention BaseNet | +1.89 | 4.11 | 0.46 |
| FBLight ConvNet | +1.44 | 2.23 | 0.65 |
| IFNet | +1.00 | 3.66 | 0.27 |

**One of ten.** The protocol effect is real and large for EEG-TCNet and is not
separable from noise for the other nine.

Stated carefully, because the point of this column is not to make the opposite
overclaim: this treats the two protocols as independent samples, using the
deviations the paper reports. A paired analysis over the same four
participants would have more power, and the paper may well have run one. The
narrow claim is the one that matters here — **from the numbers this dataset
serves, nine of those gaps do not support a direction**, so a column built on
this dataset must not assert one.

## What it does to a ranking

Offline, FBCNet ({{claim:fbcnet-offline}}) beats EEG-TCNet
({{claim:tcnet-offline}}) by eight points. Online, EEG-TCNet
({{claim:tcnet-online}}) beats FBCNet ({{claim:fbcnet-online}}) by four and a
half. The pair swaps — and this one survives, because it is EEG-TCNet's gap
doing the work rather than FBCNet's.

A review sentence that says "FBCNet outperforms EEG-TCNet" is true, of one
protocol, and is not marked as such anywhere in the sentence. That is the
failure mode this platform exists to catch — except that until this dataset
existed, the platform could not have caught it either, because a fact here
carried no room for the analysis that produced it, and then carried no room
for how uncertain it was.

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

It is an illustration of protocol sensitivity, not a leaderboard. The
`method:` line on every claim above is what stops it being read as one, and
the `select: dispersion` claims are what stop the differences being read as
larger than they are.

The tolerances above are not error bars. A tolerance is how far the author will
let the dataset drift before this sentence is flagged; a dispersion is how
uncertain the measurement was to begin with. They look alike side by side and
they are different quantities, which is why they are separate lines.
