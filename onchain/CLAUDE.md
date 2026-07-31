# onchain/ — Aiken gate validator

Plutus V3 Aiken project holding the NFT Gate withdraw-zero validator. Full context in
[docs/SPEC.md](../docs/SPEC.md) §3 (architecture) and §11 N3 (test requirements).

## Workflow

```sh
aiken check          # compile + run tests
aiken build          # emit plutus.json (CIP-57 blueprint)
pnpm vendor          # aiken build + copy plutus.json into packages/sdk/src/
```

The SDK loads the vendored copy at runtime; forgetting the re-vendor means the SDK ships a
stale validator. `plutus.json` here is gitignored; only the vendored SDK copy is tracked, and
CI fails if it differs byte-for-byte from a fresh build.

Vendor with `pnpm vendor`, never `prettier --write` — the tracked copy is raw `aiken build`
output (no trailing newline) and `.prettierignore` keeps prettier off it. Reformatting it
would break the CI vendor check.

This directory is the `@nft-gate/onchain` workspace package, so the root `pnpm lint` /
`pnpm test` / `pnpm build` run `aiken fmt --check` / `aiken check -D` / `aiken build` here.
Working on the validator without the `aiken` binary installed is not possible.

## Pins

Aiken v1.1.23, `aiken-lang/stdlib` v3.1.0 (locked in `aiken.lock`). Stdlib imports that
compile against this version: `cardano/address.{Credential}`, `cardano/transaction.{Transaction}`;
for the real check you'll also need `cardano/assets` (`PolicyId`, `tokens`),
`aiken/collection/list`, `aiken/collection/dict` — verify against the installed stdlib if the
compiler objects.

## Rules for this directory

- The real check (SPEC §3.1, finalized 2026-07-30) lives in `lib/gate/check.ak` — a pure
  function (`satisfies_gate`) shared by both integration modes; `validators/gate.ak` is the
  thin wrapper (logic only, no tests). Params: `asset_policy` + `asset_name_prefix` ("" =
  any name; CIP-68 label or full name to scope within a policy) + `min_quantity` (clamped to
  ≥1 on-chain) + `owner` (retire authority). Withdraw passes iff one UTxO among
  reference_inputs OR spent inputs holds ≥ threshold prefix-matching tokens under the policy
  AND its `VerificationKey` payment credential is in `extra_signatories`.
- `publish` handler: registration passes; deregistration passes **only for the compile-time
  `owner` param** (4th validator param); delegation fails (keeps the reward balance at zero
  so zero-withdrawals stay valid). `spend` handler: gate-address UTxOs released only by
  their inline `GateDatum{owner}` — datum authority is self-referential only and must NEVER
  gate deregistration (planted-UTxO spoof). All other purposes fail via `else`.
- Tests live in dedicated `*.test.ak` files: `lib/gate/check.test.ak` (adversarial matrix,
  SPEC §11 N3) and `validators/gate.test.ak` (handler-level). Never mix tests into source
  modules. Aiken only compiles `lib/` and `validators/` — a top-level `tests/` dir would be
  silently ignored. These tests are safety-critical and outrank features.
- Comment only where needed: constraints/rationale the code can't show. No narration or
  filler comments.
- The blueprint validator titles are `gate.gate.withdraw` / `gate.gate.spend` / `gate.gate.publish` /
  `gate.gate.else` (same hash + compiledCode each); the SDK's blueprint loader matches on the
  `gate.` prefix — keep names in sync if you rename anything.
- CI parity: `/.github/workflows/ci.yml` (repo root — a workflow under `onchain/.github/`
  is never read by GitHub) runs the root pnpm gates, which cover this package, plus the
  vendored-blueprint check. `pnpm lint && pnpm test && pnpm build` locally is equivalent.
