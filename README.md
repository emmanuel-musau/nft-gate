# NFT Gate

Bring-your-own-token access control for Cardano DApps.

Point a **gate** at your own NFT policy ID, and the gate lets any wallet holding a token under
that policy interact with your smart contract — enforced on-chain. The on-chain gate is a
parameterized [Aiken](https://aiken-lang.org) withdraw-zero validator (the policy ID is a
compile-time parameter); the TypeScript SDK instantiates a gate from a policy ID, runs a
one-time setup, and wraps your DApp transactions so the check runs on every one of them.

Built on [evolution-sdk](https://github.com/IntersectMBO/evolution-sdk). MIT licensed.

> **Status: early development.** Nothing here is production-ready and nothing is published to
> npm. The on-chain validator, the SDK (`instantiate` · `setup` · `withGate` · `retire`) and
> the CLI are implemented, and all of them have been validated end-to-end against a live
> Preview deployment — a real NFT-gated vault, deposited into and released through the gate.
> Consumers self-deploy their own gate infrastructure; we operate, host and custody nothing.

## Packages

| Package                                      | Description                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`@nft-gate/sdk`](packages/sdk)              | TypeScript SDK: instantiate a gate, one-time setup, `withGate` transaction wrapper |
| [`@nft-gate/cli`](packages/cli)              | `nft-gate` CLI: instantiate / deploy / test a gate from the terminal               |
| [`onchain`](onchain)                         | Aiken project with the parameterized withdraw-zero gate validator                  |
| [`examples/demo-vault`](examples/demo-vault) | Example consumer DApp using the SDK                                                |

## Dashboard

**[NFT Gate on Dune](https://dune.com/jengatech/nft-gate-withdraw-zero-access-control-on-cardano)** —
adoption and execution cost of the withdraw-zero pattern on Cardano, plus a lookup for any
individual gate by script hash.

Dune indexes Cardano **mainnet** only, so a gate deployed on a testnet reads as zero there;
the ecosystem panels are live either way. The cost benchmark is worth a look: NFT Gate's
membership check measured **71,814 memory units** against a mainnet median of **1,329,085**
for withdraw-zero validators generally.

## Documentation

- [Build specification & handoff](docs/SPEC.md) — product, architecture, API, milestones (the authoritative document)
- [evolution-sdk API map](docs/evolution-sdk-api.md) — verified API names and the gotchas that cost us, read before touching SDK internals
- [CLAUDE.md](CLAUDE.md) — working conventions and current state, for contributors and coding agents

## Getting started

```sh
corepack enable
pnpm install
pnpm build
pnpm test
```

Then derive a gate — offline, no network or keys needed:

```sh
node packages/cli/dist/index.js instantiate <policyId> <ownerKeyHash>
```

`deploy`, `test-gate` and `retire` additionally need `BLOCKFROST_API_KEY` and
`WALLET_MNEMONIC` (see [.env.example](.env.example)). Run `nft-gate` with no arguments for the
full usage. A worked end-to-end example lives in
[`examples/demo-vault`](examples/demo-vault).

## License

[MIT](LICENSE) — Copyright (c) 2026 Emmanuel (Mutisya Labs)
