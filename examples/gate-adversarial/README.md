# gate-adversarial

Transactions the gate **must** reject, run against Preview and judged by the network.

The Aiken suite already proves the validator rejects bad transactions in a simulated ledger,
and `withGate` refuses to build them. Neither is evidence about an attacker: an attacker does
not use our SDK, and a simulated ledger is not a node. SPEC §13 says the compiled validator is
the sole enforcement and everything the SDK checks is UX — this harness is what holds that line
to account.

So every case here **bypasses `withGate`** and hand-assembles a transaction the SDK would never
emit, then asks the network to rule on it. No consumer validator is involved: each transaction
is a plain self-payment plus the gate's zero-withdrawal, which is enough to make the gate script
run. That isolates the gate from any DApp hosting it.

## Two gates, and why the control is not optional

| Target    | Policy                        | Wallet holds it? | Role                 |
| --------- | ----------------------------- | ---------------- | -------------------- |
| `phuffy`  | `9a556a69…76b4` (PHUFFY)      | no, and cannot   | the gate under test  |
| `adalink` | `31485bcb…44b5` (AdaLinkAuth) | yes              | the positive control |

PHUFFY is a **mainnet** voting token. A policy ID is just a script hash, so a gate on Preview can
be parameterized with it — but the wallet cannot hold one there and cannot mint one, because we
do not control the minting key. The gate is therefore unsatisfiable _by construction_, which is
what makes every rejection a true negative instead of a mistake we made.

That alone would be worthless. A suite that only ever reports rejections cannot distinguish a
sound gate from a broken harness — if the pipeline were misassembling transactions, everything
would "fail" and the run would look like a pass. So `control` runs the **same pipeline** against
a gate the wallet genuinely satisfies, using `withGate` exactly as a consumer would, and it must
come back ACCEPTED. Run it first; the rejections only mean something afterwards.

The harness asserts both premises at startup rather than assuming them, and refuses to run if
the wallet's holdings contradict the role it was given.

## How a verdict is obtained

evolution-sdk ships no local UPLC evaluator, so script evaluation is a round trip to the
provider — the verdict comes from a real node, not from this machine. The transaction builder
collapses that response into a generic build failure, which is useless as evidence, so
`capturingEvaluator` calls Blockfrost's `/utils/txs/evaluate` itself and keeps the raw body.

Outcomes are read from that body, never from whether the build threw. A build failure only says
the SDK gave up somewhere; the provider response says what the network thinks. Anything that
yields no verdict is reported INCONCLUSIVE and fails the run — it is not quietly counted as a
pass.

## Commands

```sh
pnpm build
node --env-file=.env examples/gate-adversarial/dist/index.js control   # must be ACCEPTED
node --env-file=.env examples/gate-adversarial/dist/index.js run       # must be all REJECTED
node --env-file=.env examples/gate-adversarial/dist/index.js deploy  [phuffy|adalink]
node --env-file=.env examples/gate-adversarial/dist/index.js retire  [phuffy|adalink]
node --env-file=.env examples/gate-adversarial/dist/index.js probe   <case>
```

Run from the repo root so `--env-file=.env` resolves. Deploying a gate costs a 2 ADA stake
deposit plus ~4.3 ADA of min-ADA for the reference script; `retire` reclaims both.

`probe` goes further than `run`: it builds past evaluation with an invented budget so the
transaction is actually signed and offered to the node, then prints the node's objection in
full. See the note on two-phase validation below for why this is free.

## Results — Preview, 2026-08-02

Gate under test `d21bf8f5192401563bd84048b36d990da5fd065e0c11eeaaf1ccb839`
(PHUFFY policy, exact-name prefix `504855464659`, minQuantity 1).
Control gate `55de2d7457cfbbf748b404c615d39d6f14af84cc8d54bdfb7322fd54`.

**Control — accepted, as required:**

```
{"EvaluationResult":{"withdrawal:0":{"memory":57501,"steps":17081112}}}
```

**Attacks — all five rejected**, each with
`{"EvaluationFailure":{"ScriptFailures":{}}}`:

| Case                     | What it poses                                        | Property held                                   |
| ------------------------ | ---------------------------------------------------- | ----------------------------------------------- |
| `no-proof`               | the withdrawal alone, correctly signed               | membership is required                          |
| `wrong-policy-reference` | a real token under another policy as the proof       | the policy parameter is enforced                |
| `wrong-policy-bulk`      | 130,718,954 tokens under another policy              | quantity cannot substitute for the right policy |
| `wrong-policy-spent`     | that token **spent** rather than referenced          | the spent-input branch is policy-checked too    |
| `no-signer`              | a proof input without its owner as a required signer | holding is not enough — the holder must sign    |

The SDK layer was checked in the same run and refused to build at all, which is the UX layer
behaving correctly and exactly what these cases route around.

### Probed against the node, 2026-08-03 — `no-proof` and `wrong-policy-reference`

Ogmios' evaluate endpoint returns `ScriptFailures: {}`, an empty map: a verdict with no
reasoning. Offering the transaction to the node itself gives the reasoning in full. Both cases
were refused identically, naming our gate and the withdrawal purpose:

```
ConwayUtxowFailure (UtxoFailure (UtxosFailure (ValidationTagMismatch (IsValid True)
  (FailedUnexpectedly (PlutusFailure "
    The PlutusV3 script failed:
    The script hash is: ScriptHash "d21bf8f5192401563bd84048b36d990da5fd065e0c11eeaaf1ccb839"
    The plutus evaluation error is: CekError An error has occurred:
      The machine terminated because of an error, either from a built-in function
      or from an explicit use of 'error'.
    ScriptInfo: RewardingScript (ScriptCredential d21bf8f5192401563bd84048b36d990da5fd065e0c11eeaaf1ccb839)
    TxInfo: …full inputs, reference inputs and signatories…
```

That is the compiled gate, executed by a node, on the withdrawal purpose, terminating in
`error` — which is what the Aiken validator compiles a failed check down to.

**Why this costs nothing, and why nothing lands on-chain.** A transaction built by any normal
builder claims `isValid = True`. When the node finds a script failing anyway, that is a
_contradiction_ rather than an expected phase-2 failure, so it reports `ValidationTagMismatch`
and refuses the transaction outright — it never enters a block and no collateral is taken.
Getting an on-chain phase-2 artifact would require submitting with `isValid = False`, which
evolution-sdk does not expose. So there is no publicly linkable transaction hash for these
rejections; there is a node's itemised refusal, which is the stronger evidence of the two.

### What this run does not prove

Stated plainly, because a security artifact that overstates its reach is worse than none:

- **No rejection is recorded on-chain**, for the reason above. Every result here is a node's
  refusal, reproducible on demand but not permanently linkable.
- **Three N3 cases are still unreached** and cannot be posed by a wallet holding no PHUFFY:
  a token present but below `minQuantity`; a matching token held at a _script_ address; and the
  CIP-68 reference-token-vs-user-token name-prefix distinction. Reaching them needs a gate on a
  policy we can mint under on Preview.
- **The coin-selection gotcha** in `docs/evolution-sdk-api.md` is still untested — it needs a
  holder whose token and entire ADA balance sit in one UTxO.
- **Deregistration by a non-owner** is untested here. It would mean deploying a gate owned by a
  key we do not hold, whose deposits could then never be reclaimed.
