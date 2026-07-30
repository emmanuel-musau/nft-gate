---
"@nft-gate/sdk": minor
---

Implement the on-chain gate validator (M1) and vendor its blueprint. The gate
takes three compile-time parameters — `asset_policy`, `asset_name_prefix`
("" = any name; CIP-68 label or full name to scope within a policy), and
`min_quantity` (clamped to ≥ 1 on-chain) — and passes iff a single key-owned
reference or spent input holds enough matching tokens and its owner signed the
transaction. Stake registration passes; deregistration and all other purposes
fail, making a deployed gate permanent.

SDK stub API aligned ahead of M2: `instantiate(policyId, { minQuantity, assetNamePrefix, network })`
with an options object, and `GateInstance` now carries `assetPolicyId`,
`assetNamePrefix`, and `minQuantity`.
