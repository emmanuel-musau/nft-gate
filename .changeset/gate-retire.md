---
"@nft-gate/sdk": minor
---

Add gate retirement (reclaim both deposits) — the gate is now owner-retirable
instead of permanent:

- On-chain: 4th compile-time param `owner`; new `spend` handler releasing
  gate-address UTxOs only to their inline `GateDatum{owner}`; `publish` now
  admits deregistration signed by the compile-time owner (datum authority is
  deliberately never used for deregistration — planted-UTxO spoof, see SPEC
  §3.1 — with a regression test).
- `setup` switches to Conway registration certificates and writes
  `GateDatum{owner}` as the inline datum on the reference-script output.
- New `retire(client, gate, options?)`: one transaction spending the
  reference-script UTxO and deregistering the stake credential (script
  attached inline, no reward withdrawal), returning the tx hash; funds default
  to the signing wallet's change address. New `GateRetireError`.
- `instantiate` requires `owner` in options; `GateInstance` carries it.
- CLI: `instantiate <policyId> <ownerKeyHash>`; `retire` command stub prints
  the end-of-life warning (retiring breaks every DApp referencing the gate).
