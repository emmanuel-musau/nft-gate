# NFT Gate — Build Specification & Handoff

**Purpose of this document:** a complete, self-contained brief for a coding agent (Claude Code) to build the NFT Gate tool. It captures the product, the architecture, the technology choices, the repository layout, per-component requirements, and the current state of the scaffold. Read it top to bottom before writing code.

**Reference repo (match its conventions):** https://github.com/IntersectMBO/evolution-sdk
**License:** MIT · **Repo visibility:** public open-source · **Owner:** Mutisya Labs (Emmanuel)

---

## 1. What we are building

**NFT Gate is bring-your-own-token access control for Cardano DApps.** A project points a "gate" at their own NFT policy ID, and the gate lets any wallet holding a token under that policy interact with a smart contract — enforced on-chain. If the wallet holds the token, the action goes through; if not, the whole transaction is rejected by the ledger.

There is **no external identity registry** and **no operator**. Each project is the sole authority over its own gate, and each project runs its own one-time deployment. We ship reusable tooling; consumers run it and own the resulting on-chain infrastructure.

### Mental model

Think of a bouncer at a club door. The **club** is any Cardano DApp. The **membership card** is an NFT the project already issues. The **bouncer** is a small on-chain validator that checks, on every gated action, whether the acting wallet holds a valid card — and only ever _looks_, never moves or spends the NFT. Two outcomes, decided by the chain: card present → allowed; card missing → transaction rejected.

The genuinely valuable, genuinely hard part is **not** the on-chain check (it is tiny). It is the **off-chain SDK** that assembles the transactions so a DApp author can adopt the gate in an afternoon without understanding the machinery.

---

## 2. Core design decisions (already settled — do not relitigate)

1. **Bring-your-own-NFT.** The token that grants access is chosen by the consuming project (their own policy ID). No shared/curated allowlist of registries.
2. **Policy ID is a compile-time parameter.** Each project's gate is produced by baking _their_ policy ID into the validator, yielding a unique script + hash per project. "Acme's gate" = "the gate parameterized with Acme's policy." This keeps trust fully decentralized and us out of the trust path.
3. **Withdraw-zero trigger (flagship integration mode).** The gate is a withdrawal (staking) validator; a transaction includes a zero-ADA withdrawal from its reward account to force the gate to run once per transaction. (Same idiom Cardano's Pyth integration uses.)
4. **Embedded mode (documented fallback).** The core check is a shared pure function; a DApp author who prefers can call it directly inside their own spending validator. The withdraw-zero validator is a thin wrapper over the same function. Build the withdraw-zero path as the real deliverable; offer embedded as a documented one-liner, not a second hardened product.
5. **Model A — consumer self-deploys.** Projects run the one-time setup themselves via the SDK/CLI, signing with their own wallet and owning the reward account + reference-script UTxO. We operate, host, and custody nothing. This is deliberate: the maintainer does not want to run per-client infrastructure.
6. **The SDK is the product.** The on-chain surface is intentionally minimal; complexity is concentrated in off-chain transaction assembly, built on evolution-sdk.

---

## 3. On-chain architecture (Aiken, Plutus V3)

### 3.1 The gate validator

_(Design finalized 2026-07-30; this section supersedes the earlier conceptual sketch.)_

A **withdrawal validator** parameterized by **three compile-time values**:

1. `asset_policy: PolicyId` — the membership token's policy;
2. `asset_name_prefix: AssetName` — only tokens whose asset name **starts with** this prefix
   count. Empty (the default) matches every name (whole-collection gating). A CIP-68 label
   (e.g. `000de140` for `(222)` user tokens) scopes the gate to user tokens and excludes
   key-held `(100)` reference tokens; a full asset name yields single-beacon gating (the
   adalink `[policy, name]` pattern). Note this is **scoping within a legitimate policy, not
   a defense against a compromised one** — minters choose asset names, so the policy remains
   the root of trust;
3. `min_quantity: Int` — the minimum holdings required to pass. NFT projects use `1`; larger
   values enable fungible-token gating ("hold ≥ 1000 $TOKEN"). The effective threshold is
   clamped to at least 1 on-chain (`math.max(min_quantity, 1)`) so a misconfigured
   `0`/negative parameter can never produce a vacuous gate that admits everyone.

Any parameter change ⇒ a different script hash, i.e. a different gate.

**The check (withdraw purpose):** the gate passes iff **some single UTxO among the
transaction's `reference_inputs` _or_ its spent `inputs`** satisfies all of:

- (a) the total quantity of tokens under `asset_policy` whose names start with
  `asset_name_prefix` in that one UTxO is ≥ `max(min_quantity, 1)` (quantities are
  **per-UTxO, not summed across UTxOs** — one `list.any` scan, simplest to audit; the SDK
  consolidates a user's tokens into one UTxO if needed);
- (b) its payment credential is a `VerificationKey`;
- (c) that key hash appears in the transaction's `extra_signatories`.

The check lives as a **pure function in `lib/gate/check.ak`** (this is the embedded-mode API);
`validators/gate.ak` is a thin wrapper. The redeemer is ignored.

**Why signer binding matters:** without requiring the proof-UTxO's owner to also be a
transaction signer, anyone could point at _someone else's_ NFT UTxO to pass the gate. Binding
to `extra_signatories` closes that spoof. A corollary: **only key-owned UTxOs qualify** —
tokens held at script addresses (contract-locked, script-based smart wallets, native-script
multisig) cannot "sign" and therefore never pass in v1. This is the anti-spoof mechanism, not
an oversight; document it as a known limitation.

**Why reference inputs (not spending):** the NFT is proven present without being moved, spent,
or locked. The user keeps their asset untouched. Spent `inputs` are _also_ accepted purely as
defense in depth: if a consumer builds a transaction without `withGate` and their wallet's
coin selection happens to spend the token's UTxO in the same transaction, a
reference-inputs-only gate would reject a legitimate holder. Signer binding applies
identically to both lists, so this widens nothing for attackers.

**Certificates (publish purpose):** the validator carries an explicit `publish` handler:

- **stake registration** (`RegisterCredential`) → always passes, so `setup` works regardless
  of whether the SDK/ledger emits the legacy or the Conway-style registration certificate
  (the new style makes the script itself run);
- **deregistration** (`UnregisterCredential`) → always fails. A live gate can never be
  grief-killed (deregistration would break every dependent DApp and hand the ~2 ADA deposit
  refund to the attacker). The gate is **permanent**; the deposit is intentionally
  unrecoverable — say so in the docs;
- **everything else** (delegation, DRep, pool certs) → fails. Forbidding delegation keeps the
  reward-account balance at exactly zero forever, which matters: the ledger requires a
  withdrawal to take the _full_ reward balance, so any accrued rewards would invalidate the
  zero-withdrawal trigger.

All remaining purposes (spend, mint, vote, propose) are rejected via `else(_) { fail }`.

### 3.2 The zero-withdrawal trigger — why it exists

On Cardano, a validator only runs when a transaction gives it a _script purpose_ to run (spend / mint / withdraw / etc.). A gate that needs to run as a global, once-per-transaction check can't rely on `spend` (that only fires per-UTxO at the gate's own address and would run redundantly). The **withdraw** purpose solves it:

- Every script has a reward account keyed by its hash.
- A transaction may withdraw **zero** ADA from that account — costing nothing, moving nothing.
- Doing so forces the gate's withdrawal validator to run **exactly once** for the whole transaction.

The withdrawal is a pretext whose only job is to summon the check.

### 3.3 How a DApp opts in (the one-line hook)

The gate cannot force itself into a foreign transaction. The consuming DApp's own spending validator adds a single requirement: _"this transaction must include a withdrawal from gate-account-X."_ That requirement chains the two together — the DApp's action cannot succeed unless the gate ran and approved. Integration is therefore **cooperative** (a hook the DApp author adds when they deploy their own validator), **not** injection into already-deployed immutable third-party contracts. The spec and docs must state this honestly.

### 3.4 Anatomy of a gated transaction (runtime)

```
INPUTS (spent):
  • DApp's locked UTxO        -> fires DApp validator, which requires the gate withdrawal
WITHDRAWALS:
  • 0 ADA from gate reward account -> fires the gate validator (runs the check once)
REFERENCE INPUTS (read, not spent):
  • gate reference-script UTxO  -> loads the gate's compiled code cheaply
  • user's NFT UTxO             -> proof of membership
SIGNATORIES:
  • user's key                  -> binds the NFT to the actor
Result: no valid NFT under the policy -> whole transaction rejected on-chain.
```

### 3.5 Upgrades

Because the policy ID is a compile-time parameter, changing the accepted policy means recompiling → a new hash → a new gate the DApp adopts on its next deploy. For the "one project, one membership policy" model this is fine and rare. (A future v2 could support multiple/changeable policies via a project-owned config UTxO authenticated by a beacon token; explicitly **out of scope** for v1.)

---

## 4. Deployment model (Model A — consumer self-deploys)

Per project/gate instance, done once, run by the consumer (wrapped behind the SDK/CLI so they never think about the internals):

1. **Instantiate (no transaction):** apply the project's policy ID to the compiled blueprint → get the parameterized script + its hash. The hash is the stable credential the DApp hard-codes.
2. **Register the gate's reward account (1 tx, required):** submit a stake-registration certificate for the gate's stake credential (= script hash). Costs the standard stake deposit (~2 ADA, refundable). Without this, no zero-withdrawal can trigger the gate.
3. **Publish the reference-script UTxO (1 tx, strongly recommended):** create one UTxO whose `reference_script` field holds the compiled gate, so every gated transaction references the code cheaply instead of inlining it. Decide placement: an address the operator controls (recoverable min-ADA, mild centralization) vs. a provably-unspendable address (permanent, trustless, min-ADA gone). Default toward permanence for a shared public good; make it configurable.

We (the maintainer) run **none** of this on mainnet. The example may be deployed on Preview for demonstration only.

---

## 5. Off-chain SDK — the flagship deliverable (`@nft-gate/sdk`)

Built on `@evolution-sdk/evolution` and `effect`. Three jobs, plus blueprint loading.

### 5.1 Target public API

```ts
interface GateInstance {
  script: string; // compiled, parameterized validator (CBOR hex)
  hash: string; // script hash — the credential DApps hard-code
  policyId: string; // the company NFT policy this gate admits
}

interface SetupResult {
  rewardAccount: string; // bech32 reward account the zero-withdrawal targets
  referenceScriptUtxo: string; // "txHash#index" of the published reference script
}

// 1) Pure: bake the three parameters into the blueprint, derive the hash.
//    minQuantity defaults to 1 (NFT gating); assetNamePrefix (hex) defaults to "" = any name
//    (CIP-68 label to scope to user tokens; full name for single-beacon gating).
function instantiate(
  policyId: string,
  options?: { minQuantity?: number; assetNamePrefix?: string },
): GateInstance;

// 2) One-time, consumer-run: register reward account + publish reference script.
//    Written with Effect (Effect.gen) to mirror evolution-sdk's style.
function setup(gate: GateInstance /*, client/wallet */): Effect.Effect<SetupResult, Error>;

// 3) The hot path: wrap a DApp tx so the gate check runs.
//    Appends: reference the gate script + the user's NFT UTxO,
//    add the zero-withdrawal from setup.rewardAccount, require the user as signer.
function withGate(
  tx: TxBuilder,
  gate: GateInstance,
  setup: SetupResult,
  userAddress: string,
): TxBuilder;

// Loads the compiled Aiken blueprint (plutus.json) produced by the on-chain build.
function loadGateBlueprint(): { compiledCode: string };
```

### 5.2 evolution-sdk API notes (verify against live docs)

From the evolution-sdk README, the shape is:

```ts
import { Address, Assets, Client, preprod } from "@evolution-sdk/evolution";
const sdk = Client.make(preprod)
  .withBlockfrost({ baseUrl, projectId })
  .withSeed({ mnemonic, accountIndex });
const tx = await sdk.newTx().payToAddress({ address, assets }).build();
const signed = await tx.sign();
const hash = await signed.submit();
```

Relevant modules exist for: `PolicyId`, `Assets`/`Value`/`MultiAsset`, `Credential`, `RewardAccount`, `Withdrawals`, `ScriptHash`, `ScriptRef`, `Certificate` (stake registration), reference scripts, and Plutus V3 script evaluation. Providers: Blockfrost, Maestro, Koios, Kupo/Ogmios. It is Effect-powered.

**Action for the agent:** the exact method names for (a) applying a parameter to a script/blueprint, (b) building a stake-registration certificate, (c) creating a reference-script output, and (d) adding a zero withdrawal + reference inputs, **must be confirmed against the live API** at https://intersectmbo.github.io/evolution-sdk (and its `/api` reference) and by reading `packages/evolution` in the repo. Do not assume names; verify, then implement.

---

## 6. CLI (`@nft-gate/cli`)

A thin wrapper over the SDK. Binary name `nft-gate`. Commands:

- `nft-gate instantiate <policyId>` → prints the gate hash.
- `nft-gate deploy` → runs `setup` on a chosen network (M3).
- `nft-gate test-gate` → dry-run a gated transaction against Preview (M3).

It ships nothing new; it exposes the SDK on the command line for developers evaluating/onboarding.

---

## 7. Example DApp (`examples/demo-vault`)

A real, working gated contract + app used as proof, reference, and integration template — and as the M3 test harness against Preview. Contains:

- an Aiken **vault** spending validator demonstrating the one-line withdraw-zero hook;
- an app (`deposit.ts`) showing a consumer calling `instantiate` + `withGate` end-to-end.

Not published to npm.

---

## 8. Technology & toolchain (mirror evolution-sdk exactly)

- **Package manager:** pnpm (workspaces), via corepack.
- **Monorepo build:** Turborepo (`turbo.json`, v2 "tasks" schema).
- **Language:** TypeScript 5.4+ strict, ESM, `module`/`moduleResolution` = **NodeNext**, `verbatimModuleSyntax` on → use `import type` for types and `.js` extensions on relative imports.
- **FP framework:** **Effect** (async, typed errors) — this is the key thing to learn; `setup.ts` is the teaching sandbox.
- **Tests:** Vitest.
- **Lint/format:** ESLint 9 flat config + Prettier (double quotes, semicolons, trailing commas, printWidth 100).
- **Versioning:** Changesets.
- **On-chain:** Aiken (Plutus V3), via aikup.
- **SDK deps:** `@evolution-sdk/evolution` ^0.5.11, `effect` ^3.10.

---

## 9. Repository structure (target)

```
nft-gate/
├─ package.json  pnpm-workspace.yaml  turbo.json
├─ tsconfig.base.json  eslint.config.mjs  .prettierrc.json  vitest.config.ts
├─ .gitignore  .env.example  LICENSE  README.md
├─ .changeset/
├─ onchain/                       # Aiken project
│  ├─ aiken.toml
│  ├─ lib/gate/check.ak           # reusable core check (shared by both modes)
│  ├─ lib/gate/check.test.ak      # adversarial test matrix for the check
│  ├─ validators/gate.ak          # withdraw-zero validator (thin wrapper, logic only)
│  ├─ validators/gate.test.ak     # handler-level tests
│  └─ plutus.json                 # BUILD OUTPUT (copied into the SDK)
├─ packages/
│  ├─ sdk/  (@nft-gate/sdk)       # instantiate · setup (Effect) · withGate · blueprint
│  │  └─ src/{index,types,blueprint,instantiate,setup,gate-tx}.ts + *.test.ts + plutus.json
│  └─ cli/  (@nft-gate/cli)       # nft-gate command (wraps the SDK)
│     └─ src/index.ts
├─ examples/demo-vault/           # gated demo contract + app
│  ├─ onchain/                    # vault validator with the hook (add later)
│  └─ app/src/deposit.ts
└─ docs/                          # integration guide + architecture (later)
```

---

## 10. Current state of the scaffold (what already exists)

The repo root exists with `git init` done and empty `packages/`, `examples/`, `docs/` folders. **Nothing else is created yet.** The agent should build the full tree above from scratch, mirroring evolution-sdk conventions, and must inspect the directory first (`ls -la`) rather than assume.

If a full scaffold-from-current-state prompt is provided separately, follow it; otherwise create everything in Section 9. All not-yet-implemented functions should compile but throw / `Effect.fail` with a clear "not implemented — M2/M3" message and a TODO describing exactly what they must do.

> **Status note (2026-07-30):** the M1 scaffold described above has been built — full monorepo,
> vendored blueprint, passing build/test/type-check/lint. **M1 on-chain core is implemented**:
> the real check per §3.1 lives in `lib/gate/check.ak` with `validators/gate.ak` as the thin
> wrapper (withdraw + publish + else), 24 aiken tests covering the N3 adversarial matrix, and
> the rebuilt blueprint re-vendored into the SDK. See the root `CLAUDE.md` for current state
> and known divergences from §5.1.

---

## 11. Requirements & acceptance criteria

### Functional

- **F1** `instantiate(policyId, options?)` returns a `GateInstance` with a deterministic `hash` derived from the parameterized script; any differing parameter (policy, name prefix, quantity) yields a different hash.
- **F2** `setup(gate)` performs the two one-time transactions (stake registration, reference-script publish) and returns a `SetupResult`; it never requires the maintainer's keys (consumer signs).
- **F3** `withGate(tx, gate, setup, userAddress)` appends the reference to the gate script, the reference to the user's NFT UTxO, the zero-withdrawal from the reward account, and the user as a required signer — producing a transaction that succeeds iff the user holds a token under the policy.
- **F4** The on-chain gate passes iff a single reference input _or_ spent input holds ≥ `max(min_quantity, 1)` tokens under the parameterized policy matching the name prefix AND that input's payment key signed the transaction; stake registration passes, deregistration and all other certificates/purposes fail (§3.1).
- **F5** `nft-gate instantiate <policyId>` prints the hash; other commands stubbed with clear "not implemented (M3)" until built.
- **F6** The example demonstrates a full gated interaction on the Preview testnet.

### Non-functional

- **N1** ESM, strict TypeScript, zero `any` in public APIs; typed errors via Effect where async.
- **N2** `pnpm build`, `pnpm test`, `pnpm type-check`, `pnpm lint` all pass at every milestone boundary.
- **N3** The on-chain validator is minimal, readable, and unit-tested with explicit adversarial fail cases: missing token; token present but owner not a signer; wrong policy; wrong name prefix (incl. CIP-68 reference token vs user token); quantity below threshold (including split across UTxOs); token at a script address; deregistration and non-withdraw purposes rejected.
- **N4** No secrets committed; `.env` gitignored; `.env.example` provided.
- **N5** Nothing published to npm until the SDK is real (packages stay `0.0.0`, unpublished).
- **N6** MIT license file present; README present and accurate.

---

## 12. Milestones (build order — each produces something verifiable)

- **M1 — On-chain core (weeks 1–3):** `check.ak` + `gate.ak` + tests; `aiken check`/`aiken build` produce `plutus.json`; copy it to `packages/sdk/src/plutus.json`. Implement the real check from Section 3.1 (replace the compiling stub).
- **M2 — SDK (weeks 4–6):** implement `instantiate` → `setup` (Effect) → `withGate` against evolution-sdk (verify API names first). Published-shape package, documented, with a scripted Preview demo.
- **M3 — CLI, example DApp & Dune (weeks 6–7):** CLI commands; working gated demo vault on Preview; public Dune dashboard tracking gate deployments and gated-transaction volume.
- **M4 — Hardening, docs & release (weeks 7–8):** adversarial testing on Preview, integration guide, architecture docs, video walkthrough, MIT open-source release.

---

## 13. Security considerations

- Access control is safety-critical: prioritize the on-chain check's correctness and its adversarial tests over features.
- Enforce the **SDK-check vs validator-check** distinction everywhere: the SDK finding/attaching the NFT is UX only and enforces nothing; the compiled validator is the sole enforcement and cannot be bypassed. Never let these blur in code or docs.
- Never place secrets in code, URLs, or committed files. Handle mnemonics/API keys only via untracked `.env`.
- The reference-script UTxO is a public dependency for adopters; document its placement/permanence policy clearly.

---

## 14. Open questions / decisions still to make

1. Reference-script UTxO placement: operator-controlled (recoverable) vs provably-unspendable (permanent). Default: permanent; make configurable.
2. Provider default for `setup`/examples (Blockfrost vs Kupo/Ogmios) and how the consumer supplies it.
3. CLI packaging: separate `@nft-gate/cli` package (chosen) vs `bin` inside the SDK.
4. Whether to add GitHub Actions CI (lint + build + test on push) — recommended for a public grant repo; mirror evolution-sdk's `.github`.
5. Multiple/changeable policies per project (config-UTxO + beacon) — explicitly deferred to a possible v2.

---

## 15. References

- evolution-sdk repo: https://github.com/IntersectMBO/evolution-sdk (conventions, `packages/evolution` for real examples)
- evolution-sdk docs: https://intersectmbo.github.io/evolution-sdk (and `/api`)
- Idiom precedent (zero-withdrawal as a per-tx verifier): Cardano's Pyth on-chain integration.
- Target grant: Cardano Catalyst August 2026 pilot (on-chain identity + integrate-with-existing-DApps criteria).
