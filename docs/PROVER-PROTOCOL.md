# The prover protocol

**Status: protocol and verifier built and tested. No prover artefacts ship with
this repository, and the platform does not run a prover. See "What is not here"
at the bottom before relying on any of it.**

Layer 1 severed *who paid* from *who reads what*. This is the protocol for
severing *the platform* from *the user's Google identity* — the thing Layer 2
was supposed to do and could not, because a zero-knowledge proof needs a
prover, and a prover the platform runs is the platform.

The answer is that the platform already depends on machines it does not run. A
contributor serves their own columns from their own disk. Proving is another
node type.

---

## The honest tradeoff, first

**A prover sees the JWT you send it.** It learns that you signed in to Cephroom
with a particular Google account, at a particular moment.

This does not eliminate trust. It **moves** it, from the platform to a party
you choose. That is only an improvement if the choice is real, so:

- **Running your own is the configuration with no trust assumption at all**, and
  it is the one this document leads with. A prover is one process and one
  command. If you run it, nobody sees your token but you.
- **There is no platform-blessed prover.** Not a default, not a fallback, not a
  "recommended" one, and not a list published here that would function as one.
  `/api/zk/params` deliberately carries no prover list.
- **The platform cannot tell provers apart.** Prover identity is not an input
  to verification — there is no field for it in a submission, no allowlist, and
  no callback. `tests/contracts/prover-neutrality.test.ts` fails if any of that
  changes. A proof from a prover nobody has heard of verifies exactly like one
  from a prover we have.

What a prover does **not** learn:

| | |
| --- | --- |
| What you read afterwards | Proving happens at sign-in; reading happens later, against a contributor's node, over a Layer 1 anonymous token. Nothing joins them. |
| Which resource the proof is for | The challenge is 32 random bytes with no structure. It names nothing. |
| Whether the proof was used | The prover is not told, and has no way to ask. |

The residual, stated rather than buried: **a prover that logged every JWT it
saw would know who signs in to Cephroom and when.** That is strictly less than
the platform knows today, and it is yours to place rather than ours.

---

## Running your own prover

This is the path with no trust assumption, so it comes first.

```bash
git clone <this repo> && cd cephroom && npm install
npm run prover:fetch          # circuit artefacts — see "Artefacts" below
npm run prover:serve          # on 127.0.0.1:4700
```

Then, on the sign-in screen, enter `http://127.0.0.1:4700` as your prover. The
client checks `GET /prover` against the platform's published parameters before
sending anything; if the circuit or the verification key hash disagree, it
refuses and tells you, rather than sending your token somewhere that cannot use
it.

The process holds each JWT for the length of one request, writes nothing to
disk, and has no logging flag. That is a property of the code in `node/prover.ts`
rather than a promise, and it is short enough to read.

---

## The node interface

A prover is any HTTP service implementing two endpoints. There is no
registration, no key exchange, and nothing to sign up for.

### `GET /prover`

```json
{
  "protocol": "cephroom-prover/1",
  "system": "plonk",
  "circuit": "jwt-tx-validation@27cda6e",
  "verificationKeyHash": "<sha256 hex>",
  "ready": true,
  "notice": "This prover sees the JWT you send it. ..."
}
```

A client compares `circuit`, `system` and `verificationKeyHash` against
`/api/zk/params`. All three must match or the proof will not verify, and the
client should say so **before** any token leaves the browser.

Deliberately absent: any name, operator, contact or description field.
A prover is identified by its URL and judged by whether its artefacts match.
Anything else would be marketing, and marketing is how a default emerges.

### `POST /prove`

```json
{ "jwt": "<id_token>", "challenge": "<64 hex chars>", "salt": "<field element>" }
```

→

```json
{ "proof": { ... }, "publicSignals": ["...", "..."] }
```

The prover derives every circuit index from the token itself rather than
accepting them from the caller, so a caller cannot steer it into proving over
the wrong bytes. It rejects a token whose `nonce` does not answer the given
challenge, before doing any expensive work.

Errors return a message and never echo the input. A JWT in an error string ends
up in a log aggregator, a proxy, or a browser console.

---

## What the platform does

The platform is **strictly a verifier**. It must never operate a prover — not
a default one, not a fallback, not one "just for convenience". The moment it
does, the separation this design exists to create is gone, because a prover we
run is us. `tests/contracts/prover-neutrality.test.ts` asserts that nothing
under `src/` calls a proving function, and the local `snarkjs` type declaration
deliberately declares only `verify`.

### `GET /api/zk/params`

The circuit pin, the proof system, the public signal layout, the verification
key hash, and the identity providers accepted. Everything needed to verify;
nothing about who proves.

### `POST /api/zk/challenge`

32 random bytes, valid for ten minutes. Unauthenticated — the caller has no
identity yet, which is the point.

### Verification

1. The submission is `{ proof, publicSignals, challenge }`. **Three fields.**
   There is nowhere to name a prover.
2. The challenge must be one this platform issued and not yet spent. **A ZKP
   does not prevent replay: a valid proof copied is still valid.** The spend
   goes through the Layer 1 nullifier store — same bounded epochs, same
   restatement of Contract 1, same assertion that an entry can hold nothing
   but the fact that it exists.
3. The challenge is spent **before** the pairing check, so a flood of junk
   proofs against one challenge costs one verification rather than one each.
4. The RSA modulus is a public signal, and must be one the provider is
   currently publishing. Every key seen in the JWKS in the last 14 days counts
   — the same rolling-window trick as the token issuer's two live epochs, and
   the one the zkLogin paper describes for its oracles. **This is the whole of
   key-rotation handling**, and it was always the easy part.
5. `nonceContentHash` must name the challenge being answered, so a proof cannot
   be lifted out of one session into another.
6. The proof verifies against the published verification key.

What comes out is `oidcDigest` — `Poseidon(iss, aud, sub, salt)` — which
becomes the pseudonymous subject. The salt is the user's and the platform never
sees it, so the subject is stable for that user and reveals nothing about the
Google account behind it.

---

## The salt, and the thing it costs

The salt is what makes `oidcDigest` unlinkable to a Google account. It has to
be the same every time or the user's subject changes and their subscription
goes with it.

**Held by the user, it is the only version with no trusted party — and it binds
the identity to wherever it is kept.** Sign in on another machine without
carrying the salt and you are a different person to this platform. Lose it and
you lose the subscription.

zkLogin solves this with a salt service. A salt service is another party that,
together with the provider, can link you. This protocol does not specify one,
and if a deployment adds one it belongs in the "where the contracts bend" list
with that consequence written out.

This is a real cost and it is why the ZK path is opt-in rather than the default
sign-in.

---

## Proof system: PLONK, and the measurement that decided it

Measured here — four circuit sizes, in Chrome and in Node, on a 16-core
machine:

| | Groth16 | PLONK |
| --- | --- | --- |
| verification | ~8 ms | ~10 ms |
| proof size | 724 B | 2,097 B |
| proving key | 513 B/constraint → **~0.55 GB** at 1.1M | 2,738 B/constraint → **~3.0 GB** |
| proving (snarkjs) | ~31 s floor at 1.1M | ~10 min floor at 1.1M |
| setup | **per circuit, with toxic waste** | **universal, deterministic** |

**Verification cost and proof size are constant in circuit size.** That is the
asymmetry the whole architecture rests on: the 1.1M-constraint circuit that
makes browser proving impossible costs a verifier the same ~10 ms and ~2 KB as
a 1,000-constraint one. Proving is expensive and verifying is not, so put
proving somewhere that can afford it.

The setup row decided the choice. Two independent PLONK setups of the same
circuit produce **byte-identical** keys — checked by hashing them — so there is
no secret to leak and anyone can regenerate the verification key and confirm
the published hash. Two Groth16 contributions produce different keys, because
each injects randomness whose destruction is an assumption you are asked to
take on faith.

**A Groth16 ceremony with a single contributor means that contributor can forge
proofs for every user, forever.** Nobody in this repository is in a position to
run a credible multi-party ceremony, so Groth16 here would be asking users to
trust a ceremony of one. That is not a tradeoff; it is a disqualification.

A deployment that *can* run a real ceremony may pin `groth16` and take the ~20×
proving speedup. It must then publish whose ceremony it was. The verifier reads
the system from the published parameters and does not care which.

The proving figures are floors from a linear fit, not estimates — snarkjs is
pure JS/WASM and a native prover is substantially faster. They are stated as
floors because a fitted exponent over this range comes out *sublinear*, which
is impossible for either system, and quoting it would be the sort of number
this project does not quote.

---

## Circuit: not written here

**An under-constrained circuit still produces proofs that verify. It just
proves something weaker than intended, and every test passes.** That is the
highest-risk part of this work, and the reason none of it was written here.

The pinned circuit is `jwt-tx-validation.circom` from
[Moonsong-Labs/zksync-social-login-circuit](https://github.com/Moonsong-Labs/zksync-social-login-circuit)
at commit `27cda6e74492fbad4aa3ca37ff5084ed391b534b`, **audited by OpenZeppelin**
between 24 March and 11 April 2025: nine findings — zero critical, zero high,
two medium, three low, four notes — all resolved. The auditors concluded the
implementation "was found to be sound and well-written".

It proves exactly what is needed here:

- the JWT was signed RSA-SHA256 by a key whose modulus is a **public** input,
  so the verifier can check it against the live JWKS;
- `oidcDigest = Poseidon(iss, aud, sub, salt)` is a **public** output;
- the `nonce` claim hashes to a **public** value recomputed in-circuit from a
  private blinding factor, which is how a proof binds to a challenge.

The JWT, the signature and the salt are private inputs.

Two caveats worth stating. The circuit was audited in a Groth16 deployment
context; using the same R1CS under PLONK does not change its constraints, but
the audit was not of that deployment. And the repository is archived, so a
deployment should vendor the pinned commit rather than depend on it staying
reachable.

---

## What is not here

Scope check, as honestly as the Layer 2 one:

- **No circuit artefacts.** The compiled `.wasm`, the proving key and the
  verification key are build outputs of a ~1.1M-constraint circuit — around
  3 GB under PLONK. They are not in this repository, `npm run prover:fetch`
  is a documented hook rather than a working download, and **no prover can
  actually prove until a deployment supplies them.**
- **Therefore the end-to-end path is unproven.** The protocol, the verifier,
  the challenge binding, the replay spend, the JWKS rotation window and the
  witness construction are each built and tested. They have never been run
  against a real Google token and a real proving key, and this document does
  not claim they have.
- **No deployment has pinned a verification key.** `ZK_VERIFICATION_KEY_SHA256`
  is unset, so `/api/zk/params` publishes `null` and verification would refuse
  everything. That is the correct posture for a protocol with no artefacts: it
  fails closed.

What *is* built and tested is the part the instruction called useful before any
prover exists — the specification of what a prover must do, and the verifier
that depends on public parameters and nothing else.
