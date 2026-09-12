# The API

One API, both roles. A contributor wires serving into a pipeline without
opening a browser; a consumer discovers, fetches and **checks** work from a
script without trusting how this site renders anything.

Two rules shape everything below, and both are consequences of the contracts
rather than style choices:

- **The API never carries content.** `/api/v1/read/...` returns an *address*.
  The bytes come from the contributor's machine to yours, and the platform is
  not in that request — so there is no proxy endpoint, and there will not be
  one, because a proxy would make the platform a host.
- **Liveness answers about now.** There is no endpoint listing what has ever
  existed and none reporting who served what over time. An index of everything
  is a copy of everything; an activity log is an activity record about a person.

## No API keys

An API key is a stable identifier issued to a person, which the issuer stores
so it can check it. Contract 1 forbids the storing, so there are none.

What you use instead is the same anonymous token scheme the website uses:

```
renewal key  ──▶  access key  ──▶  blind-signed tokens  ──▶  read key
 (7 days,        (15 min,          (12 at a time,          (2 min, carries
  pasted once)    minted)           unlinkable)             a tier, no identity)
```

The platform signs twelve values it cannot read, and later cannot tell which
subscriber spent the one you present. That property holds from a script exactly
as it does from a browser.

---

## Consumer: nothing to working

### 1. See what is live

```bash
curl -s 'http://localhost:3000/api/v1/live?q=motor%20imagery' | jq
```

```json
{
  "api": "v1",
  "observedAt": "2026-09-12T03:01:55.305Z",
  "contributors": 1,
  "count": 2,
  "results": [
    {
      "sub": "s_localnode_marcus",
      "servedBy": "Marcus Oyelaran",
      "address": "http://127.0.0.1:4600",
      "id": "which-protocol-produced-that-number",
      "title": "A decoding accuracy is not a property of a decoder",
      "kind": "column",
      "tags": ["eeg", "bci", "decoding", "machine-learning"],
      "access": "public",
      "fetch": { "column": "http://127.0.0.1:4600/column/which-protocol-..." }
    }
  ],
  "note": "Presence only. ..."
}
```

Parameters: `q` (free text over titles, summaries, tags), `tag` (exact,
repeatable), `kind` (`column` | `dataset`). Facets are modality-first —
`eeg`, `fmri`, `electrophysiology` before disease or drug class — because the
first question about a result is how it was measured.

**There is no `?since=` and no cursor into history.** A column nobody is
serving is absent, and nothing anywhere records that it existed.

### 2. Locate one item

```bash
curl -s http://localhost:3000/api/v1/read/s_localnode_marcus/which-protocol-produced-that-number | jq
```

Returns the address, the manifest entry, the exact fetch URLs, and a `rules`
object stating the three things a client author needs to know — including that
a claim's dataset must be resolved **from the same node**, never from whichever
node happens to announce that slug. An author vouches for the data they serve;
letting a stranger's node answer would let anyone substitute the numbers a
claim is checked against.

A 404 is deliberately uninformative. The platform cannot tell you what used to
be there because it never knew.

### 3. Fetch and check

```bash
curl -s http://127.0.0.1:4600/column/which-protocol-produced-that-number | jq '.claims | length'
```

Checking is the part that matters, and you should not take the platform's word
for it. The judge is a pure module with no React and no Node built-ins:

```ts
import { resolveClaims } from "cephroom/src/lib/claims/resolve";

const run = resolveClaims(column.claims, datasets, sub, new Date().toISOString());
// run.counts → { verified, drifted, broken }
// run.views  → every claim, with its query, its authored value, and what the
//              dataset says right now
```

This is the same function the website calls. There is deliberately not a second
implementation, because two implementations of a drift rule eventually disagree
silently, which is the exact failure this platform exists to prevent.

The CLI wraps all three steps:

```bash
npx tsx scripts/cephroom.ts live "motor imagery"
npx tsx scripts/cephroom.ts read s_localnode_marcus which-protocol-produced-that-number
```

It exits non-zero when a claim is drifted or broken, so it composes into CI —
which is the whole premise of the platform, applied to itself.

### 4. Paid columns, without being identifiable

Once, in a browser: `/account` → **Reveal a key for the CLI** → copy the
command it gives you.

```bash
npx tsx scripts/cephroom.ts login <renewal key>
npx tsx scripts/cephroom.ts tokens        # 12 blind-signed tokens
npx tsx scripts/cephroom.ts read s_localnode_marcus muscarinic-liability-is-a-clozapine-problem
```

By hand, the flow is:

```bash
# renewal key → access key (comes back as a Set-Cookie)
curl -si -X POST localhost:3000/api/auth/refresh -H "cookie: cephroom_renew=$RENEWAL"

# access key → blind-signed tokens. The blinding happens in your process; this
# is the step that needs a library rather than curl, and the only one.
#   POST /api/tokens/issue   { "requests": ["<base64 blinded>", ...] }

# token → read key. No cookie. The platform cannot link this to the issuance.
curl -s -X POST localhost:3000/api/tokens/redeem \
  -H 'content-type: application/json' -d '{"token":"<base64>"}'

# read key → the node
curl -s http://127.0.0.1:4600/column/<id> -H "authorization: Bearer $READ_KEY"
```

Without a token you still get the public preview — the node decides, not the
platform, which is not in the request path and could not enforce it anyway.

---

## Contributor: nothing to serving

### 1. Check before you serve

```bash
npx tsx scripts/cephroom.ts check ./my-columns/whatever.md
```

Parses the claim grammar and reports every problem without starting anything.
This exists because the alternative — start a node, open a browser, look at the
page — is how claim errors were actually found while building this, and it is
a bad loop.

### 2. Serve

```bash
npm run node:serve -- --content ./my-columns --name "Your Name" --port 4600
```

The directory is the manifest: every `.md` file in it is served. Front matter:

```yaml
---
slug: which-protocol-produced-that-number
title: A decoding accuracy is not a property of a decoder
subtitle: One sentence.
tags: eeg, bci, decoding, machine-learning
access: public          # public | member | lab
---
```

`tags` is yours and is what the API's facets search. They were hardcoded to
`pharmacology` until the API made it visible that a motor-imagery column was
being announced under it.

### 3. Serve under your own identity, from a pipeline

Announcing is free at every tier, including the free one. To announce as *you*
rather than under the node's default subject, the node needs a serve key — and
getting one does not require a browser:

```bash
ACCESS=$(curl -si -X POST localhost:3000/api/auth/refresh \
  -H "cookie: cephroom_renew=$RENEWAL" | grep -o 'cephroom_key=[^;]*' | cut -d= -f2)

curl -s -X POST localhost:3000/api/auth/node-key -H "cookie: cephroom_key=$ACCESS" | jq -r .key
# → export NODE_KEY=...
```

Thirty days, announce-only: a leaked serve key lets somebody list content under
your subject and grants no read access to anything and no access to billing.

### 4. Watch your own announcement land

```bash
curl -s "localhost:3000/api/v1/live" | jq '.results[] | select(.sub=="'$YOUR_SUB'")'
```

Previously the only way to confirm an announcement had landed was to load a web
page and look.

---

## Rate limiting, honestly

The brief for this API said to solve rate limiting with the token scheme, and
to say so rather than reach for the easy answer if it could not be solved
cleanly. It is solved in one half and not in the other.

**Solved.** Everything that costs the platform real work is paid for with a
token:

| endpoint | bound |
| --- | --- |
| `POST /api/tokens/issue` | requires a live subscription; 12 per request |
| `POST /api/tokens/redeem` | requires an unspent token; each is single-use |
| `POST /api/zk/verify` | the challenge is spent *before* the pairing check, so N junk proofs against one challenge cost one verification |

**Not solved.** Anonymous endpoints — `/api/v1/live`, `/api/v1/read/...`,
`/api/zk/challenge` — take no token, because a reader must be able to see what
is public without subscribing and a sign-in must work before you have an
identity.

For those, the work per request is bounded (an in-memory scan, capped results)
and total memory is bounded (challenges expire by epoch and are capped at
50,000 outstanding). What is **not** bounded is requests per caller, and it
cannot be: that needs an identity for the caller, the platform does not read
client IPs anywhere, and someone signing in has no identity yet by definition.

The challenge cap has a cost worth naming rather than burying: past the
ceiling, the oldest outstanding challenges are evicted, so a flood can push out
a legitimate sign-in in flight and make it fail. Bounded degradation under
attack beats an out-of-memory crash under attack. It is a mitigation, not a
fix.

The easy answer here is an IP bucket, and it is available, and it is not taken
— reading a client address is the thing Contract 1's logging audit rules out.
A deployment behind infrastructure that rate-limits by address gets that
protection at the edge, where the platform neither sees nor stores it, and
that is the honest place for it.

---

## Everything, in one table

| | |
| --- | --- |
| `GET /api/v1/live` | what is being served now; `q`, `tag`, `kind` |
| `GET /api/v1/read/{sub}/{id}` | where to fetch one item, and the rules for doing it |
| `POST /api/auth/refresh` | renewal key → access key |
| `POST /api/auth/cli-key` | a fresh renewal key for a shell |
| `POST /api/auth/node-key` | a 30-day announce-only serve key |
| `GET /api/tokens/keys` | issuer public keys, per tier and epoch |
| `POST /api/tokens/issue` | blind-sign a batch (subscription required) |
| `POST /api/tokens/redeem` | spend one token → an anonymous read key |
| `GET /api/zk/params` | circuit pin, proof system, signal layout, provider keys |
| `POST /api/zk/challenge` | a challenge for a proved sign-in |
| `POST /api/signal` | announce, heartbeat, withdraw (nodes) |
| `GET /.well-known/cephroom-key` | the public key a node verifies readers with |

On the contributor's node, not the platform:

| | |
| --- | --- |
| `GET /manifest` | what this node serves |
| `GET /column/{id}` | a column; send a read key for the full text |
| `GET /dataset/{id}` | a dataset and its facts |
| `GET /proposals?column={id}` | open proposals on a column |
| `POST /proposals` | propose an edit (needs an attributable key) |

On a prover node — see [PROVER-PROTOCOL.md](PROVER-PROTOCOL.md):

| | |
| --- | --- |
| `GET /prover` | what it can prove, and its verification key hash |
| `POST /prove` | a JWT and a challenge in, a proof out |
