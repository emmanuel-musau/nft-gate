# onchain/ — Aiken gate validator

Plutus V3 Aiken project holding the NFT Gate withdraw-zero validator. Full context in
[docs/SPEC.md](../docs/SPEC.md) §3 (architecture) and §11 N3 (test requirements).

## Workflow

```sh
aiken check          # compile + run tests
aiken build          # emit plutus.json (CIP-57 blueprint)
cp plutus.json ../packages/sdk/src/plutus.json   # ALWAYS re-vendor after a build
```

The SDK loads the vendored copy at runtime; forgetting the copy step means the SDK ships a
stale validator. `plutus.json` here is gitignored; only the vendored SDK copy is tracked.

## Pins

Aiken v1.1.23, `aiken-lang/stdlib` v3.1.0 (locked in `aiken.lock`). Stdlib imports that
compile against this version: `cardano/address.{Credential}`, `cardano/transaction.{Transaction}`;
for the real check you'll also need `cardano/assets` (`PolicyId`, `tokens`),
`aiken/collection/list`, `aiken/collection/dict` — verify against the installed stdlib if the
compiler objects.

## Rules for this directory

- `validators/gate.ak` is currently a **stub that approves everything** — never deploy it.
  The real check (SPEC §3.1): pass iff a reference input holds a token under `company_policy`
  AND that input's payment credential is a `VerificationKey` present in `extra_signatories`.
- Target structure per SPEC §9: extract the core check into `lib/gate/check.ak` (shared pure
  function — embedded mode), keep `validators/gate.ak` a thin wrapper, and add
  `tests/gate_test.ak` with pass + adversarial fail cases (missing NFT; NFT present but owner
  not a signer; wrong policy). These tests are safety-critical and outrank features.
- The blueprint validator titles are `gate.gate.withdraw` / `gate.gate.else`; the SDK's
  blueprint loader matches on the `gate.` prefix — keep names in sync if you rename anything.
- CI parity: `.github/workflows/continuous-integration.yml` runs `aiken fmt --check`,
  `aiken check -D`, `aiken build` — run all three locally before considering work done.
