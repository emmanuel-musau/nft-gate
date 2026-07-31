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

| Path                   | What                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `onchain/`             | Aiken project (Plutus V3). `validators/gate.ak` = withdraw-zero gate. Has its own CLAUDE.md.  |
| `packages/sdk/`        | `@nft-gate/sdk` — instantiate · setup (Effect) · withGate · blueprint loader                  |
| `packages/cli/`        | `@nft-gate/cli` — `nft-gate` bin wrapping the SDK                                             |
| `examples/demo-vault/` | Consumer demo: `onchain/` = Aiken vault w/ the withdraw-zero hook; `app/` = deposit flow (M3) |
| `docs/SPEC.md`         | Full build specification & handoff — the authoritative document                               |

## Commands

```sh
pnpm install            # corepack-managed pnpm 11 (workspace)
pnpm build              # turbo: tsc per package + `aiken build`; sdk copies src/plutus.json into dist/
pnpm test               # vitest (packages/sdk) + `aiken check -D` (onchain)
pnpm type-check         # tsc --noEmit per package
pnpm lint               # eslint 9 flat config (root eslint.config.mjs) + `aiken fmt --check`
pnpm format:check       # prettier
node packages/cli/dist/index.js   # run the CLI after build
```

`onchain/` is the `@nft-gate/onchain` workspace package, so the four gates above cover the
validator — **the `aiken` binary is required to run them**, at exactly the pinned v1.1.23
(`aikup install v1.1.23`); an older binary makes `aiken check -D` fail on a version warning.
After changing the validator, re-vendor the blueprint with
`pnpm --filter @nft-gate/onchain vendor` and commit the result; CI fails if the tracked copy
differs from a fresh build. See `onchain/CLAUDE.md`.

`examples/demo-vault/onchain/` is a second Aiken project (`@nft-gate/demo-vault-onchain`),
covered by the same four gates but **not vendored** — its blueprint is copied into the demo
app at build time, and only the gate blueprint is tracked in git.

## Conventions (mirror evolution-sdk)

- ESM only; `module`/`moduleResolution` = NodeNext; `verbatimModuleSyntax` on →
  **use `import type` for types and `.js` extensions on relative imports**.
- **Effect** for anything async or fallible (`Effect.gen`, `Data.TaggedError`); `setup.ts` is
  the style reference. Zero `any` in public APIs.
- Prettier: double quotes, semicolons, trailing commas, printWidth 100. ESLint 9 flat config.
- **Comments only where needed**: a comment must state a constraint or rationale the code
  can't show. No narration, no restating what a line does, no filler. Keep validator/source
  files logic-only; tests live in separate `*.test.ak` / `*.test.ts` files.
- **One test file per source module**, colocated: `foo.ts` → `foo.test.ts`, testing only
  `foo.ts`. Shared TS fixtures live in `packages/sdk/src/__fixtures__/` (excluded from
  `tsconfig.build.json`, so they never reach `dist/`). The `instantiate` hash fixture is the
  documented exception — it declares its own literals so an unrelated fixture edit can't
  break the `aiken blueprint apply` cross-check.
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
  (one-tx spend + deregister, inline script, no withdrawal, change to owner), plus
  `applyParamsToPlutusV3` in `script.ts` — the param-application + single-CBOR strip that
  `instantiate` uses, exported because consumer hook validators need it too. 28 SDK tests
  across 6 files (one per module).
  **`setup` is live-validated on Preview (2026-07-31)** — see below. `withGate` and `retire`
  have still never run against a network.
- CLI: `instantiate <policyId> <ownerKeyHash>` works; `deploy`/`retire`/`test-gate` exit 1
  ("not implemented (M3)"); `retire` prints the end-of-life warning.
- demo-vault (M3, 2026-07-31): vault validator + `app/src/{vault,deposit}.ts` wired against
  the real AdaLinkPlatformAuth policy on Preview. Vault hash cross-verified vs
  `aiken blueprint apply`. See `examples/demo-vault/README.md`.

### First live deployment — Preview, 2026-07-31

`setup` ran end-to-end against Preview and verified against Blockfrost. Gate
`55de2d7457cfbbf748b404c615d39d6f14af84cc8d54bdfb7322fd54` (AdaLinkPlatformAuth policy,
exact-name prefix, minQuantity 1). Confirmed on-chain: reward account `registered: true`
with `pool_id: null` (never delegated, so the balance stays 0 and zero-withdrawals stay
valid); the reference-script UTxO sits at the gate's **own** script address carrying
`reference_script_hash` equal to the gate hash and an inline `GateDatum` whose owner field
matches the deploying wallet's payment key hash. Min-ADA for that output was 4.36 ADA.
So the Conway `registerStake` path, the `publish` handler, and the reference-script output
all work as designed. The `deposit`/`withdraw` legs are still unproven.

### API divergence — resolved

SPEC §5.1 was updated 2026-07-30 to the implemented API (options-object `instantiate`,
`setup(client, gate, opts?)`, Effect-returning `withGate(reader, tx, ...)`); the earlier
stub-vs-spec divergence no longer exists. The spec and `packages/sdk/src` now agree.

## Gotchas

- **evolution-sdk API names must be verified, never assumed** (SPEC §5.2): check
  https://intersectmbo.github.io/evolution-sdk and read `packages/evolution` in the repo
  before writing `setup`/`withGate` internals — especially applying params to a script,
  stake-registration certificates, reference-script outputs, and zero withdrawals.
- Vitest resolves config from the package cwd and does **not** walk up, so every package that
  has tests owns a `vitest.config.ts`. The root config only declares `projects` so
  `npx vitest` at the root runs them all; adding config there alone would apply to nothing.
- `.gitignore` ignores every `plutus.json` **except** the vendored copy at
  `packages/sdk/src/plutus.json`. The blueprint validator title is `gate.gate.withdraw`.
- The vendored `plutus.json` is **prettier-ignored on purpose**: it must stay byte-identical
  to raw `aiken build` output (which has no trailing newline) or the CI vendor check fails.
  `pnpm-lock.yaml` is prettier-ignored too — pnpm rewrites it on every install.
- Toolchain pins: Aiken v1.1.23 + stdlib v3.1.0 (`onchain/aiken.lock`), pnpm 11
  (`packageManager` field), **Node ≥ 22.13** — the floor comes from pinned pnpm 11.18, not
  from the TS target; on Node 20 corepack fails with `No such built-in module: node:sqlite`.
  pnpm build-script approvals live in `pnpm-workspace.yaml` (`allowBuilds`).
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
