# NFT Gate

Bring-your-own-token access control for Cardano DApps.

Point a **gate** at your own NFT policy ID, and the gate lets any wallet holding a token under
that policy interact with your smart contract — enforced on-chain. The on-chain gate is a
parameterized [Aiken](https://aiken-lang.org) withdraw-zero validator (the policy ID is a
compile-time parameter); the TypeScript SDK instantiates a gate from a policy ID, runs a
one-time setup, and wraps your DApp transactions so the check runs on every one of them.

Built on [evolution-sdk](https://github.com/IntersectMBO/evolution-sdk). MIT licensed.

> **Status: early development.** Nothing here is production-ready; most SDK functions are
> stubs that fail with "not implemented" (milestone M2/M3). Consumers self-deploy their own
> gate infrastructure — we operate nothing.

## Packages

| Package | Description |
| --- | --- |
| [`@nft-gate/sdk`](packages/sdk) | TypeScript SDK: instantiate a gate, one-time setup, `withGate` transaction wrapper |
| [`@nft-gate/cli`](packages/cli) | `nft-gate` CLI: instantiate / deploy / test a gate from the terminal |
| [`onchain`](onchain) | Aiken project with the parameterized withdraw-zero gate validator |
| [`examples/demo-vault`](examples/demo-vault) | Example consumer DApp using the SDK |

## Getting started

```sh
corepack enable
pnpm install
pnpm build
pnpm test
```

## License

[MIT](LICENSE) — Copyright (c) 2026 Emmanuel (Mutisya Labs)
