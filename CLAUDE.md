# NFT Gate — Claude Code guide

Bring-your-own-token access control for Cardano DApps: a project points a "gate" at their own
NFT policy ID, and a parameterized Aiken withdraw-zero validator enforces on-chain that only
wallets holding a token under that policy can interact with the DApp. The TypeScript SDK
(built on evolution-sdk) is the flagship deliverable; the on-chain surface is intentionally tiny.

**Source of truth: [docs/SPEC.md](docs/SPEC.md).** Read it before implementing anything
non-trivial. This file is the operational quick reference; the spec wins on any conflict.

## Settled decisions — do not relitigate (SPEC §2)

- Bring-your-own-NFT; policy ID is a **compile-time parameter** (unique script + hash per project).
- **Withdraw-zero trigger** is the flagship mode; embedded mode is a documented fallback only.
- **Model A**: consumers self-deploy (register reward account + publish reference script). We
  operate, host, and custody nothing.
- The SDK is the product; complexity lives off-chain.

## Repo map

| Path                   | What                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `onchain/`             | Aiken project (Plutus V3). `validators/gate.ak` = withdraw-zero gate. Has its own CLAUDE.md. |
| `packages/sdk/`        | `@nft-gate/sdk` — instantiate · setup (Effect) · withGate · blueprint loader                 |
| `packages/cli/`        | `@nft-gate/cli` — `nft-gate` bin wrapping the SDK                                            |
| `examples/demo-vault/` | Consumer demo: gated vault (on-chain hook validator still TODO)                              |
| `docs/SPEC.md`         | Full build specification & handoff — the authoritative document                              |

## Commands

```sh
pnpm install            # corepack-managed pnpm 11 (workspace)
pnpm build              # turbo: tsc per package; sdk build copies src/plutus.json into dist/
pnpm test               # vitest (currently only packages/sdk has tests)
pnpm type-check         # tsc --noEmit per package
pnpm lint               # eslint 9 flat config (root eslint.config.mjs)
pnpm format:check       # prettier
node packages/cli/dist/index.js   # run the CLI after build
```

On-chain (from `onchain/`): `aiken check`, `aiken build`, then
`cp plutus.json ../packages/sdk/src/plutus.json` — see `onchain/CLAUDE.md`.

## Conventions (mirror evolution-sdk)

- ESM only; `module`/`moduleResolution` = NodeNext; `verbatimModuleSyntax` on →
  **use `import type` for types and `.js` extensions on relative imports**.
- **Effect** for anything async or fallible (`Effect.gen`, `Data.TaggedError`); `setup.ts` is
  the style reference. Zero `any` in public APIs.
- Prettier: double quotes, semicolons, trailing commas, printWidth 100. ESLint 9 flat config.
- **Comments only where needed**: a comment must state a constraint or rationale the code
  can't show. No narration, no restating what a line does, no filler. Keep validator/source
  files logic-only; tests live in separate `*.test.ak` / `*.test.ts` files.
- Changesets for versioning. Packages stay `0.0.0` and **must not be published to npm** until
  the SDK is real (SPEC N5).

## Current state (updated 2026-07-31)

M1 on-chain core + M2 SDK surface **implemented** (retire feature added 2026-07-31):

- `lib/gate/check.ak` holds the membership check (pure fn, embedded-mode API);
  `validators/gate.ak` has four handlers: `withdraw` (membership), `spend` (gate-address
  UTxOs released only by their inline `GateDatum{owner}`), `publish` (registration passes;
  deregistration only for the compile-time `owner`; delegation fails), `else fail`. **Four
  params**: `asset_policy`, `asset_name_prefix`, `min_quantity`, `owner`. Datum authority
  must never gate deregistration (planted-UTxO spoof — see SPEC §3.1 and the
  `publish_rejects_deregistration_via_planted_datum` regression test). 34 aiken tests.
- evolution-sdk API verified against installed 0.5.11 — map + empirical gotchas in
  `docs/evolution-sdk-api.md` (read before touching SDK internals; re-verify on dep bump).
- SDK implemented: `instantiate` (4 params, hash cross-verified vs `aiken blueprint apply`
  fixture), `setup` (Conway registration + ref script w/ `GateDatum` inline datum at the
  gate's own address), `withGate` (Effect, structural deps, offline-tested), `retire`
  (one-tx spend + deregister, inline script, no withdrawal, change to owner). 18 SDK tests.
  **Nothing has run against a live network — that validation is M3.**
- CLI: `instantiate <policyId> <ownerKeyHash>` works; `deploy`/`retire`/`test-gate` exit 1
  ("not implemented (M3)"); `retire` prints the end-of-life warning.

### API divergence — resolved

SPEC §5.1 was updated 2026-07-30 to the implemented API (options-object `instantiate`,
`setup(client, gate, opts?)`, Effect-returning `withGate(reader, tx, ...)`); the earlier
stub-vs-spec divergence no longer exists. The spec and `packages/sdk/src` now agree.

## Gotchas

- **evolution-sdk API names must be verified, never assumed** (SPEC §5.2): check
  https://intersectmbo.github.io/evolution-sdk and read `packages/evolution` in the repo
  before writing `setup`/`withGate` internals — especially applying params to a script,
  stake-registration certificates, reference-script outputs, and zero withdrawals.
- Root `vitest.config.ts` is **not** picked up by per-package `vitest run` (vitest resolves
  config from the package cwd and does not walk up). Package tests currently run on defaults.
- `.gitignore` ignores every `plutus.json` **except** the vendored copy at
  `packages/sdk/src/plutus.json`. The blueprint validator title is `gate.gate.withdraw`.
- Toolchain pins: Aiken v1.1.23 + stdlib v3.1.0 (`onchain/aiken.lock`), pnpm 11
  (`packageManager` field), Node ≥ 20. pnpm build-script approvals live in
  `pnpm-workspace.yaml` (`allowBuilds`).
- The blueprint is loaded from disk at runtime (`blueprint.ts` reads `plutus.json` next to the
  module); the sdk build step copies it into `dist/`. Keep that copy step when touching builds.

## Security (SPEC §13 — safety-critical)

- The **compiled validator is the sole enforcement**; anything the SDK checks or attaches is
  UX only. Never blur this distinction in code, comments, or docs.
- On-chain check correctness + adversarial tests (missing NFT; NFT present but owner didn't
  sign; wrong policy) take priority over features (SPEC N3).
- Never commit secrets. Mnemonics/API keys only via untracked `.env` (`.env.example` has the
  placeholders: `BLOCKFROST_API_KEY`, `WALLET_MNEMONIC`).

## Milestones (SPEC §12)

M1 on-chain core (real check + tests) → M2 SDK against evolution-sdk → M3 CLI + demo vault on
Preview + Dune dashboard → M4 hardening/docs/release. `pnpm build/test/type-check/lint` must
pass at every milestone boundary.
