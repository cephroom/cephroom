# Competitive notes

Concrete observations from visiting real products, and — as importantly —
which patterns this product must **reject** because of the three contracts.
A rejected pattern with its reason is as valuable as an adopted one.

Visited as a reader only. Attack scope stays on the local dev server.

---

## 2026-09-12 — GitHub (github.com/about) and Zenodo (zenodo.org)

### GitHub — the archetype for Contract 1

Observed on the About page: the entire pitch is scale-of-network —
"225M+ developers, 800M+ repositories." The value proposition is *the graph*:
who forked what, who reviewed what, whose work builds on whose.

- **Adopt (the thesis):** GitHub's worth is not storage, it is that every
  change is attributable, diffable, reviewable. Our claim + proposal loop is
  the scientific translation and must stay the spine of the product. When a
  change would make us "a nicer blog," this page is the reminder of what we
  are instead.
- **Reject (the profile graph):** GitHub is built entirely on persistent user
  profiles — followers, contribution graphs, stars, org membership. Every one
  of those is a stored personal record. Contract 2 forbids all of it. We get
  attribution (pseudonymous subject, self-declared display name in a live
  announcement) without the profile. **No follower counts, no contribution
  calendars, no "trending contributors," no stars.** These would each require
  a user table. Recorded so they are never mistaken for obvious wins.
- **Reject (the archive):** every GitHub repo is permanent and cached on their
  servers. Contract 3 forbids that. Our discovery is presence-only. A reader
  arriving at a dormant column gets an honest "nobody is serving this," not a
  cached snapshot. This is the sharpest divergence and must not erode.

### Zenodo — the anti-pattern that clarifies our contracts

Zenodo is a research-data repository run by CERN. Its "Why use Zenodo?"
section is almost a point-by-point inversion of our architecture, which makes
it the most useful thing I looked at:

| Zenodo promises | Our stance |
| --- | --- |
| "Safe — stored for as long as CERN exists" | We store nothing. Persistence is the contributor's, not ours. Opposite by design. |
| "Citeable — every upload gets a DOI" | A DOI is a permanent identifier backed by permanent storage. We cannot mint one; our identifier is `sub/slug` and resolves only while served. **This is a real gap for researchers** (citability) and an honest cost of Contract 3 — recorded below. |
| "Versioning — update your dataset" ("1354 more versions exist") | Version history is client/author-side here; the platform holds no version chain. |
| "Usage statistics on all uploads" | Download counts are an activity record about people. Contract 2 forbids them outright. **No view counts, no download stats, no trending.** |
| "Restricted access mode" | We have this — member/lab gating — but enforced by the *node* verifying a signed key, not by a central ACL table. |

**The citability gap is the one worth sitting with.** Researchers need a
stable, resolvable identifier to cite (Zenodo's whole pitch is the DOI).
Contract 3 means a `receptorome.example/read/<sub>/<slug>` link resolves only
while the author serves it — uncitable in the DOI sense. We cannot fix this
by caching (that breaks Contract 3). The honest framing, already in the
product's copy, is that this is a *live reading surface*, not an archive. But
a later cycle should consider whether a content-addressed identifier (a hash
of the column bytes) could let a reader verify they are reading the same
bytes a citation referred to, even served by a different node — continuity
without the platform storing anything. That would be genuinely novel and
contract-clean. Noted for the research/extend steps, not built yet.

### Loading / empty-state / onboarding observations

- **Zenodo's landing is a live feed** of recent uploads with version counts
  and two engagement numbers per item. We deliberately cannot show the
  engagement numbers (activity records). Our `/read` "reading now" feed is the
  contract-clean equivalent: live, but of *presence* not *popularity*.
- **Neither product's cold empty-state was observable** (both are always
  populated at scale). Ours genuinely can be empty, and the honest "Nobody is
  serving anything — Receptorome has no archive" state is a feature of the
  model, not a failure. Confirmed it reads as intentional in the role walk.
- **GitHub onboarding** funnels hard to account creation. Ours must not: there
  is no account. The nearest equivalent — "get a key" — is framed as exactly
  that on `/signin`, and serving needs no account at all.

### Net: patterns adopted vs rejected this visit

- Adopt: attribution-and-diff as the spine; live feed of what exists now.
- Reject (each would need a user table or an archive): profiles, followers,
  stars, contribution graphs, view/download stats, trending, DOIs backed by
  central storage, permanent cached repos.
- Open question for later cycles: content-addressed identifiers for
  cite-time verification without storage.
