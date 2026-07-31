# demo-vault

A working NFT-gated vault on Preview — the reference integration for `@nft-gate/sdk`.

Deposits go into a script address; releasing one requires a transaction that also runs the
gate, which passes only for wallets holding **AdaLinkPlatformAuth** (policy
`31485bcbe7184757c9a8b8526bc79672671f12466ed8880c42b344b5`, name
`4164614c696e6b506c6174666f726d41757468`).

| File                          | What                                                                    |
| ----------------------------- | ----------------------------------------------------------------------- |
| `onchain/validators/vault.ak` | The vault validator. The hook is one line: demand the gate's withdrawal |
| `app/src/vault.ts`            | Binds the vault to a gate; deposit + gated withdraw                     |
| `app/src/deposit.ts`          | Runnable end-to-end flow                                                |

## Prerequisites

1. A Preview **Blockfrost** project ID.
2. A wallet mnemonic whose account holds **at least one AdaLinkPlatformAuth token on Preview**
   and enough test ADA for: the 2 ADA stake-registration deposit, min-ADA for the published
   reference script (measured at 4.36 ADA on Preview, 2026-07-31), the 5 ADA demo deposit,
   and fees. ~15 test ADA is comfortable.
3. Both in an untracked `.env` at the repo root (see `.env.example`).

## Run

```sh
pnpm build
node --env-file=.env examples/demo-vault/dist/src/deposit.js all
```

Commands: `deploy` (one-time gate setup) · `deposit` · `withdraw` · `all` (default).

The one-time `setup` result is cached in `deployment.preview.json` (untracked) so re-runs don't
try to register the reward account twice — the ledger rejects that. Delete it only if you
intend to deploy a fresh gate; the file is keyed by gate script hash, so changing any gate
parameter invalidates it automatically.

## Known rough edge

`withGate` adds the holder's NFT UTxO as a **reference input**, and evolution-sdk excludes
reference inputs from coin selection. A wallet whose NFT and entire ADA balance sit in one
UTxO therefore has nothing left to select from, and the build fails with a generic
coin-selection error. Split the wallet into more than one UTxO, or `collectFrom` the proof
UTxO instead — `satisfies_gate` accepts spent inputs as well as reference inputs. See
`docs/evolution-sdk-api.md`.
