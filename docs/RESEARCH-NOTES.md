# Attestation of kind — what exists, what failed, what is possible

Read before designing anything. The brief that prompted this asked for a third
subscription: an attestation of *kind* — human or AI — that a party may
optionally present, that the counterparty may act on, and that the platform
never gates, ranks, filters, prices or records on. Verification is required;
self-declaration is not enough.

This file is the reading, not the design. It exists because the honest answer
to "can you verify that a client is an AI?" turns out to be *no*, and that
answer changes what is worth building. Finding it out after building something
would have meant shipping a claim we could not support.

Everything below is prior art with a date on it. Where a mechanism failed, the
reason it failed is recorded, because those reasons are the constraints the
brief already states and it is useful to see that they were arrived at
independently.

---

## 1. The human side: what has been built

### 1.1 Privacy Pass, as an architecture rather than a token

We already use Privacy Pass for anonymous search tokens, but only half of it.
The architecture (RFC 9576) separates three roles that we currently collapse
into one:

| Role | Does | Who it is here today |
| --- | --- | --- |
| **Attester** | Checks something about the client | us |
| **Issuer** | Blind-signs a token | us |
| **Origin** | Checks a presented token | us |

The separation is the whole point. The attester learns *who* and never sees the
token; the issuer signs a value it cannot read; the origin sees a valid token
and cannot tell whose it was. It works because the attester and the issuer are
different parties who do not collude.

Our token issuance is the degenerate case: we attest (check the subscription),
we issue, and we verify. That is fine for search reach, because the thing being
attested is *our own* subscription, which we necessarily know. It is not fine
for a kind attestation, because the thing being attested is a property of the
person, and we have no business learning it.

So the interesting finding is structural rather than cryptographic: **for a
kind attestation, we can only ever be the origin.** Being the attester would
mean learning what somebody is, which is exactly the thing we must not record.

### 1.2 Apple Private Access Tokens — the deployed case

The largest deployment of human attestation on the web. A device with a Secure
Enclave asks an iCloud attester for a token; the attester checks the device
certificate and that the Apple account is in good standing; Cloudflare or Fastly
act as issuer; the origin gets a token instead of a CAPTCHA. Token type 0x0002
(publicly verifiable, blind RSA) is what makes an origin able to check it with a
public key alone.

What it actually proves, and this is the part that matters:

> The PAT system verifies that a user owns a valid piece of Apple hardware and
> maintains an iCloud account in good standing.

Not humanity. Eric Rescorla's critique makes the point sharply: this is *very
different* from "the person solved a CAPTCHA", because a CAPTCHA policy works
just as well for people who do not own Apple devices. The attestation is about
a device and an account relationship, and "human" is an inference somebody
decided to draw from it.

Two further findings worth carrying:

- **Centralisation is the standing criticism.** Apple alone decides what
  properties a device must satisfy, and the issuers are two CDNs. Anyone
  outside those ecosystems is systematically disadvantaged. This is the
  criticism, not a footnote to it.
- **Metadata smuggling through key choice.** An attester that signs different
  people's tokens with different keys can leak a partition of its population
  through the key alone. Our own issuer already has this shape — one key per
  discovery plan — and we accept it deliberately, with the consequence stated
  on the privacy page. For a kind attestation the same mechanism is a worse
  problem, because the partition would be the kind, and the kind is not
  supposed to reach us at all.

### 1.3 Web Environment Integrity — the failure

Google's WEI proposal (2023) had browsers ask device hardware to sign an
attestation that the browser was unmodified and running on certified hardware.
Prototyped in Chromium May–November 2023, then removed after sustained
objection. Vivaldi called it dangerous on the grounds that attestation
providers could not be trusted to be neutral; the FSF called it an attack on
the free internet; Brave declined to ship it. The proposed safeguard — randomly
withholding attestation some of the time, a "holdback" — was judged inadequate
by the people objecting, because a site that wants attestation can simply retry
or treat a holdback as failure.

The lesson, stated in the terms this project uses: **an attestation scheme
fails when the verifier has to choose which attesters are blessed.** That
choice is the power, and there is no way to exercise it that does not exclude
somebody. The brief's constraint — no allowlist, an unknown issuer verifies
identically — is the same conclusion reached from the other direction.

Also worth recording: the mechanism did not die. Reporting in 2026 describes
the same device-attestation mechanism shipping as a commercial fraud product.
Refusing to build something as a standard does not stop it existing; it stops
it being compulsory.

### 1.4 Personhood credentials — the research direction

The 2024 paper from a 32-author coalition (MIT, OpenAI, Microsoft, Harvard,
a16z crypto, Decentralized Identity Foundation) is the closest thing to a
formal framework. Three design requirements, and all three are already
architectural commitments here:

1. **One credential per person per issuer** — a double-spend constraint, which
   is exactly what our nullifier set exists for.
2. **Unlinkable pseudonymity** — usage cannot be traced across services *even
   if issuers and services collude*. Our pairwise `nodeScopedSubject` is the
   same property applied to contributors.
3. **Minimal disclosure** — verification reveals nothing beyond "this holder
   holds a valid credential".

The deployed proof-of-personhood systems (World ID's iris hashing, BrightID and
Proof of Humanity's social graphs, Idena's proof-of-work-by-puzzle) differ
enormously in what they cost a person and what they prove, and none of them has
anything like universal reach. The paper's framing is that a credential is
issued by *an* issuer and that there should be many; the security argument
depends on plurality, not on any one issuer being right.

**This is the strongest support for the brief's no-allowlist constraint found
anywhere in the reading.** Plurality of issuers is not a concession to fairness;
it is the security property. A single blessed issuer is a single point of both
failure and coercion.

---

## 2. The AI side: what can and cannot be attested

### 2.1 What exists

There is a great deal of machinery, most of it from 2025–2026:

- **W3C DIDs and Verifiable Credentials** — an agent holds a signed credential
  and presents it to a verifier with no centralised identity provider. This is
  the substrate everything else builds on.
- **SPIFFE / SVID workload identity** — verifies "which specific execution is
  on the wire right now, on which host, under which cloud account".
- **C2PA content credentials** — binds an agent's identity to the content it
  produced.
- **SLSA and Sigstore** — supply-chain attestation extended to model artifacts:
  training pipeline, fine-tuning steps, deployment lineage.
- **OAuth actor claims / delegation chains** — trace an authorisation back to a
  principal with legal standing. Multi-hop delegation has no production-ready
  standard.
- **KYA ("Know Your Agent") frameworks** and, in regulation, Singapore's CSA
  addendum on agentic AI (Oct 2025), which requires a trusted agent registry
  and verifiable credentials with short-lived tokens.

### 2.2 What none of it proves

The survey literature is unusually blunt about the gap. Restating its finding
in one line: **every mechanism authenticates the container of an identity — a
token, a certificate, an SVID, a signed agent card — and not what is inside
it.** Specifically:

- **Nature is not attested; operation is.** SPIFFE tells you which process is
  on the wire. C2PA tells you which model produced an artifact. Neither tells
  you that the party in front of you is an AI rather than a person driving one,
  or a person at all.
- **Impersonation runs in both directions.** A human can operate an agent
  credential; an agent can be run by a human who holds the credentials. Model
  weights can be copied and run as many concurrent instances, so instance
  uniqueness is unenforceable without hardware binding.
- **Operator attribution is not agent verification.** Knowing who operates an
  agent is a different fact from knowing what the agent is or will do. KYA
  assesses operators.
- **The semantic gap is not an engineering problem.** A TEE faithfully executes
  whatever code it is given; an audit trail faithfully records whatever actions
  are taken. Neither verifies intent. The survey calls this a category error
  and says it may be the hard boundary of technical identity infrastructure.

### 2.3 The finding

**"This party is an AI" cannot be verified, and nothing in the literature
suggests it is about to become verifiable.** The reason is not that the
engineering is immature. It is that there is no physical or cryptographic
substrate that distinguishes a request originating from a model from a request
originating from a person, at the point where the request arrives. Both are
bytes on a socket. Every scheme that claims to tell them apart is either
(a) attesting a *device* and inferring a person from it, which is the PAT
critique, or (b) attesting an *operator's signed statement* and inferring the
nature of the client from it, which is a statement, not a proof.

What *is* achievable on the AI side is precisely (b), and it is worth having
provided it is described accurately:

> An identifiable party, with a published key and something to lose, has signed
> a statement that requests bearing this credential are automated and that they
> accept responsibility for them.

That is an **accountable declaration**, not a verified property. It cannot be
forged by somebody who is not that operator, cannot be repudiated by the
operator afterwards, and is worth something to a contributor deciding whether
to serve — because the value of the guarantee comes from the signer having a
name, not from the claim being independently checkable.

### 2.4 The symmetry, which is the useful part

Once stated plainly, the human side is in the *same position*:

| | Human | AI |
| --- | --- | --- |
| Claimed | "a person is here" | "an automated client is here" |
| Actually attested | a device with an enclave, and an account in good standing — or possession of a credential issued after some out-of-band personhood check | an operator's signed statement of responsibility |
| Proves the kind? | No | No |
| Forgeable by an outsider? | No | No |
| Who is trusted? | the issuer | the operator |

Neither attestation proves kind. Both prove that *some identifiable party
staked something* on a claim. This is a much better basis for a feature than
the one the brief started from, because it is symmetric, it is honest, and it
makes the "not a hierarchy" constraint fall out of the design rather than
having to be imposed on it by careful copy. There is no sense in which the
human side is the verified one and the AI side is the approximation. They are
the same kind of object with different signers.

---

## 3. What this implies for the design

Recorded here as constraints derived from the reading, not as a design. The
design goes in its own commit.

1. **We can only be the origin.** Attesting kind would mean learning it. The
   platform verifies what it is handed, from public parameters, and never
   issues.
2. **No allowlist, and the reading says why.** WEI died of the verifier
   choosing attesters; the personhood-credential framework treats issuer
   plurality as the security property. An unknown issuer must verify by exactly
   the same code path as a known one. The platform is not in a position to
   decide which issuers are legitimate — and, because it takes no action on the
   attestation, it does not need to be. The party who cares is the contributor
   deciding who to serve, on their own machine, with their own list if they want
   one.
3. **Nothing at rest.** An attestation is verified and discarded within the
   request. If double-spend prevention is needed, the nullifier precedent
   applies: an opaque marker, epoch-scoped, dying with the process.
4. **Unlinkable, pairwise.** If a kind attestation reaches a contributor, it
   must not let two contributors discover they are talking to the same party.
   `nodeScopedSubject` is the existing mechanism and the attestation must not
   route around it.
5. **The claim must be worded as what it proves.** Not "verified human" and
   "declared AI" — that is the hierarchy the brief forbids, smuggled in through
   accuracy. Both are attestations by an identifiable party; the wording should
   make that the shape of both, and name the signer rather than the kind
   wherever a party is shown one.
6. **Optional on both sides, and useless to us.** A contributor may filter on
   it. We may not: not for ranking, not for pricing, not for abuse control, not
   for analytics we do not have. A test should make taking any action on it a
   failure rather than a policy.

---

## Sources

- [Private Access Tokens, also not great — Eric Rescorla](https://educatedguesswork.org/posts/private-access-tokens/)
- [Privacy Pass: The New Protocol for Private Authentication — Privacy Guides](https://www.privacyguides.org/articles/2025/04/21/privacy-pass/)
- [Replace CAPTCHAs with Private Access Tokens — WWDC22](https://developer.apple.com/videos/play/wwdc2022/10077/)
- [Understand how reCAPTCHA uses Private Access Tokens — Google](https://docs.cloud.google.com/recaptcha/docs/private-access-tokens)
- [Privacy Pass: upgrading to the latest protocol version — Cloudflare](https://blog.cloudflare.com/privacy-pass-standard/)
- [Web Environment Integrity — Wikipedia](https://en.wikipedia.org/wiki/Web_Environment_Integrity)
- [Web-Environment-Integrity explainer — explainers-by-googlers](https://github.com/explainers-by-googlers/Web-Environment-Integrity/blob/main/explainer.md)
- [Personhood credentials: Artificial intelligence and the value of privacy-preserving tools to distinguish who is real online (arXiv:2408.07892)](https://arxiv.org/pdf/2408.07892)
- [Personhood Credentials: Human-Centered Design Recommendations (arXiv:2502.16375)](https://arxiv.org/html/2502.16375v1)
- [How "personhood credentials" could help prove you're a human online — MIT Technology Review](https://www.technologyreview.com/2024/09/02/1103466/how-personhood-credentials-could-help-prove-youre-a-human-online/)
- [Proof of personhood — Wikipedia](https://en.wikipedia.org/wiki/Proof_of_personhood)
- [AI Identity: Standards, Gaps, and the Semantic Intent Problem (arXiv:2604.23280)](https://arxiv.org/html/2604.23280v1)
- [Binding Agent ID (arXiv:2512.17538)](https://arxiv.org/pdf/2512.17538)
- [AgentDID: Trustless Identity Authentication for AI Agents (arXiv:2604.25189)](https://arxiv.org/pdf/2604.25189)
