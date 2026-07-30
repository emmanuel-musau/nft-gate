---
"@nft-gate/sdk": minor
---

Implement the M2 SDK surface against evolution-sdk 0.5.11:

- `instantiate(policyId, options)` — applies the gate's compile-time parameters and derives
  the script hash + reward address; cross-verified byte-for-byte against
  `aiken blueprint apply`.
- `setup(client, gate, options?)` — Effect program running the two one-time transactions
  (Conway stake registration, reference-script publish), signed and paid for by the
  consumer. The reference script defaults to the gate's own script address; placement is
  configurable via `options.referenceScriptAddress`.
- `withGate(reader, tx, gate, setup, userAddress)` — Effect program appending the gate
  reference script + proof UTxO as reference inputs, the zero-amount withdrawal, and the
  user as required signer. Proof selection (`findProofUtxo`) mirrors the validator's
  per-UTxO, key-owned, prefix-matching semantics.
- Typed errors `GateSetupError` / `GateTxError`; `docs/evolution-sdk-api.md` records the
  verified API map and empirical gotchas (double-CBOR applied scripts, reference-keyed
  MultiAsset maps).
