# Research notes

Decisions that are not derivable from the code, because what the code shows is
the option that was taken and these are mostly about the options that were not.
Each one is written so it can be argued with: the reasoning is here, not just
the conclusion.

See `CONTRACTS.md` for the contracts these decisions serve.

---

## The collusion attack cannot be prevented

**Status: resolved structurally, not cryptographically. Closed.**

The question was whether a platform could pay contributors out of a pool while
preventing two parties from draining that pool by agreeing to say a transfer
happened that did not.

It cannot, and the reason is not that the right scheme has not been found yet.

**The argument.** Consider what a receiver can produce as evidence that a
transfer occurred. Whatever the protocol, the evidence is some transcript: a
signature, a receipt, a proof, a chain of them. For the scheme to be useful the
transcript must be producible after a genuine transfer. But a transcript of a
real transfer is computable by the serving party alone — they hold everything
that goes into it, because they are one of the two parties to it and the other
party is cooperating. So anything a receiver could contribute *after* a real
transfer, they can contribute *without* one.

There is no predicate over the transcript that separates the two worlds, because
the two worlds produce identical transcripts. This is not a gap in the
construction; it is the construction being asked to distinguish two states that
are, from the outside, the same state.

**Why prover nodes do not close it.** Third-party provers were considered as a
way to have an independent party attest that the transfer happened. They do not
help, for the same reason: the prover can only attest to what it is shown, and
what it is shown is a transcript two colluding parties can produce. Moving the
attestation to a third party moves the problem, it does not solve it — the third
party is now attesting to the same indistinguishable thing.

**The resolution.** Remove the pool. A platform that holds no funds and pays
nobody has nothing for colluders to drain: two parties who agree that a transfer
happened between them are two parties moving their own money, which is not an
attack. This is contract 6, and it is why contract 6 is phrased as "never
introduce" rather than "be careful with".

The cost is real and should be stated: contributors are not paid by the
platform, so the platform cannot offer the growth lever that paying them would
be. `--pay-to` is the entire mechanism — a string relayed verbatim to readers,
with the platform not party to whatever happens next and not told that it did.

---

## zkLogin: measured, then rejected

**Status: rejected. Two reasons, only one of which can expire.**

The goal was to remove the last moment at which the platform sees a Google
account id. Today sign-in hands over an account id, which is HMAC'd into a
pseudonymous subject and dropped — but it is held, briefly, and a promise is
what stops it being held longer.

A zero-knowledge proof that the user holds a valid Google token, without ever
showing it, would replace that promise with a property.

**Reason one: cost. This may fall.**

Measured rather than estimated, against
`jwt-tx-validation@27cda6e` (Moonsong Labs, audited by OpenZeppelin 2025-04-11):

- 1.1 million constraints
- proving key approximately 550 MB for the browser to download
- at least 30 seconds to prove on a fast desktop
- the scheme's own designers report it can crash a browser outright

Hardware improves and circuits get smaller, so this is a number with a date on
it. If it were the only reason, the decision would be "not yet".

**Reason two: we are the verifier. This cannot fall.**

The obvious response to a proof too expensive for the user's browser is that the
platform proves it for them. That response is unavailable at any price.

A proof generated from the user's token, on the platform's hardware,
demonstrates nothing to the platform that it had not already seen — it saw the
token, that is what proving requires. The zero-knowledge property is a statement
about what the verifier learns, and it is void when the verifier is also the
prover. Any prover the platform ran would be the platform.

So the platform runs no prover and will not run one as a convenience. Proving is
done by the user, or by a party the user chooses. The platform is strictly the
side that checks the answer. This is contract 8.

**What was done instead.** The amount arriving at sign-in was reduced: the
platform no longer requests an email scope from any provider, so an email is not
something it forgets, it is something it never receives. That is smaller than
the proof would have been, and it is real.

---

## Third-party prover nodes: property enforced, feature unbuilt

**Status: deliberately half-done, and described that way.**

Because the platform cannot prove, a proof has to come from somewhere the
platform does not control. The design answer is that anybody can run a prover:
the circuit pin, the public-signal layout and the accepted provider keys are
published at `/api/zk/params`, and a proof from a prover the platform has never
heard of verifies exactly like a proof from one it has. `prover-neutrality.test.ts`
enforces this — the verification path may not contain a prover identity, an
allowlist, or a preference, and the submission type is pinned to
`{challenge, proof, publicSignals}`.

`node/prover.ts` exists as a reference implementation, run as a separate process.

**What is not built:** nothing calls the verifier. `verifySubmission` is
exported and tested; no route invokes it. `/api/zk/challenge` issues challenges
that no endpoint can spend. There is no sign-in flow behind any of it.

This is stated on `/privacy` — "published rather than available" — and
`stated-limits.test.ts` asserts that claim stays in step with the code in both
directions: if a route ever starts accepting a proof, the test fails until the
page stops saying the path is unusable.

The reason for building the verifier before the flow was to establish the
property while it was cheap. Adding an allowlist of trusted provers is the kind
of change that looks like an operational improvement once a flow exists and
somebody is complaining about proof quality. It is much harder to argue against
then than now.

---

## Attestation of kind: research done, design not written

**Status: open. Prior art read, six design constraints written previously and
NOT PRESENT IN THIS TREE.**

**The gap, stated rather than papered over.** Six design constraints for this
were written in an earlier working session and are not in this repository. They
have not been reconstructed here, and inventing replacements would produce
something that looks like a considered design and is not one. Anyone picking
this up should recover the original six or write new ones deliberately — not
treat this section as a substitute.

What follows is the research that is settled.

**The purpose.** To let a contributor choose who they serve — including, and
this is the case that clarifies the design, serving machines and excluding
humans. A dataset maintained for automated consumers has different needs from
one written for readers, and the interesting direction is not the one people
assume.

**"This party is an AI" cannot be verified.** This is a category error, not
immature tooling. There is no hardware root of trust for "was generated by a
model", no issuer with standing to attest it, and no observable property of a
request that distinguishes a model's output from a person pasting it. Waiting
for the tooling to mature is waiting for something that is not on the way.

**"Human" is in exactly the same position, which is the useful finding.** The
intuition is that human-attestation is solved and AI-attestation is the hard
one. It is not. Apple's Private Access Tokens — the most credible deployed
mechanism — prove that a request comes from Apple hardware associated with an
iCloud account in good standing. "Human" is an *inference* from that, and the
inference is doing all the work. The token does not say a person is present; it
says a device and an account are, and that Apple is willing to stake something
on it.

**What both sides actually are.** An identifiable party staking something on a
claim. That is the whole mechanism in both directions — for "human" and for "not
human" alike. Which means "these are not a hierarchy" is a *structural* fact
about the mechanism, not a diplomatic framing chosen to avoid offence. Any
design that treats human-attestation as the real one and machine-attestation as
an approximation has misread what the human side is doing.

**Where this intersects the contracts.** An attestation is a durable-ish claim
about a party, which puts it close to contract 2. The attesting party is a third
party who remembers something, which puts it close to contract 3's "only Stripe
may remember a person". Neither is necessarily fatal — a per-contributor,
per-session attestation that the platform relays without storing would be
consistent — but the design has to be written against the contracts explicitly,
which is what the missing six constraints presumably did.

---

## Token epoch length: an open business decision

**Status: open. Not made. Currently one hour.**

`EPOCH_SECONDS` is 3600 and `LIVE_EPOCHS` is 2, so a token is usable for between
one and two hours and a spent-marker becomes meaningless within two.

The parameter is a business decision wearing a technical costume, and the
tradeoff runs in a direction worth being explicit about.

**Shortening it raises a farmer's continuous cost without storing anything.**
Somebody who wants a stock of anonymous search capacity — bought once, spent
later, or resold — has to keep re-acquiring it as epochs retire. Shortening the
epoch makes stockpiling a subscription-shaped ongoing cost rather than a
one-time purchase. Critically, this defence is free of storage: it does not
require knowing who farmed, counting anything per person, or keeping a record.
It falls out of key rotation. That is a rare shape — most anti-abuse mechanisms
want an activity record, which contract 2 forbids.

**Shortening it also costs honest users.** A batch dies sooner, so a reader who
tops up weekly and searches occasionally finds dead tokens more often. And every
restart of the platform retires every outstanding token regardless of epoch
length, because the keys live in memory — see below.

**Not made because it is not a technical question.** The right epoch depends on
what a subscription is worth, how often a typical reader searches, and how much
farming actually occurs — none of which is known. It is recorded here so the
current value is understood as a default nobody has defended, rather than a
tuned parameter.

---

## A dead token batch falls back to identified search

**Status: partly fixed. The residual is real and is stated on `/privacy`.**

**What was wrong.** Issuer keypairs are generated in memory per epoch, so
restarting the platform replaces the keypair behind the *same* epoch number.
Every outstanding token stopped verifying while still looking current to the
browser holding it. The key page reported a healthy stock; each search popped a
token, failed redemption silently, and fell through to the identified path. The
one mechanism that exists to sever paying from searching was degrading into the
thing it prevents, and saying nothing.

**Why not persist the issuer keys.** That is the obvious fix and it is the wrong
one: a stored signing key is storage, and reaching for it here is exactly the
move contract 9 says to stop at. The tokens are publicly verifiable and the
issuer public key is already published at `/api/tokens/keys`, so the client can
detect the rotation itself.

**What was done.** The wallet stores a fingerprint of the issuer public key
alongside the batch and checks it against the published set before spending. A
batch signed under a key that is no longer published is discarded and reported,
not counted as stock. `spendToken` no longer removes a token before redemption
succeeds: a transient failure keeps the token, a refusal drops only that one.
Zero platform-side storage was added. The same defect existed independently in
the CLI and was fixed there too.

**The residual, which is not fixed.** When a batch is dead, the search still
goes out with the ordinary key, because the alternative is not searching at all.
The reader is told — on the result and on the key page — *after* the query has
gone. Narrowing that means asking before the search rather than reporting after
it, and that is not built. It is on `/privacy` in those words.

A second residual: if `/api/tokens/keys` is unreachable, staleness cannot be
determined, and the wallet reports its holding as usable rather than blocking.
That is a deliberate choice — an outage should not make the product unusable —
and it means "usable" means "not known to be dead".

---

## What a node keeps, and for how long

**Status: implemented. Retention is 90 days after resolution.**

A proposal is delivered to the contributor's own machine and stored there. It
carries a pseudonym scoped to that contributor, so the same reader appears to
two contributors as two unrelated strangers and neither can recover the platform
subject.

**The defect this fixed.** Proposals written before node-scoping existed carried
the raw platform subject — the same identifier at every contributor, which is
precisely what node-scoping exists to prevent — and the node served them on a
public page. Person-linkable data at rest on disk, with no expiry and no
deletion path.

**What now happens.** A store migrates on open: any subject that is not
node-scoped is replaced with `n_withdrawn` on disk, not merely hidden at read
time. The proposal's title, body and rationale survive — that content is the
contributor's to read, and destroying it would be a worse answer than redacting
the identifier. A node refuses, at the door, any proposal whose key names a
platform-wide subject.

**Why a retention window at all.** A node-scoped pseudonym is legitimate: the
contributor needs to be able to reply, and to rate-limit one reader's proposals
without knowing who they are. But it does not need to be legitimate forever. A
proposal that was merged or closed 90 days ago has no further exchange to
support, so the pseudonym is redacted and the record stays. Open proposals keep
theirs, because the exchange is still live.

Ninety days is a judgement, not a derivation.
