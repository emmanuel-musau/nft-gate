# evolution-sdk API map (verified against installed 0.5.11)

Verified 2026-07-30 by reading `packages/sdk/node_modules/@evolution-sdk/evolution/dist/*.d.ts`
(not the docs site — the installed package is the source of truth for our pinned version).
Revised 2026-07-31 for the retire feature: the certificate section below was written against
the pre-retire "gate is permanent" design and said the opposite of what the validator now
does. Re-verify on any dependency bump.

## (a) Applying parameters to a script

```ts
import { Data, UPLC } from "@evolution-sdk/evolution";

UPLC.applyParamsToScript(scriptHex, [
  Data.bytearray(policyHex),
  Data.bytearray(prefixHex),
  Data.int(1n),
  Data.bytearray(ownerKeyHashHex),
]);
// -> applied script CBOR hex. Aiken-compatible encoding by default.
```

- `Data.bytearray(hex: string)`, `Data.int(bigint)` build the param values. Params are
  positional — the order must match the validator's declaration (`asset_policy`,
  `asset_name_prefix`, `min_quantity`, `owner`).
- **Empirically verified gotcha:** blueprint `compiledCode` is single-CBOR, but
  `applyParamsToScript` returns **double**-CBOR — and the ledger's script hash covers the
  **single**-CBOR bytes. Strip one bytestring layer before hashing/storing (see
  `stripOneCborLayer` in `instantiate.ts`; result matches `aiken blueprint apply` exactly).
- Hash with `ScriptHash.fromScript(new PlutusV3.PlutusV3({ bytes: singleCborBytes }))` —
  classes live inside their namespace (`PlutusV3.PlutusV3`, `RewardAccount.RewardAccount`).
- `UPLC.getCborEncodingLevel(hex)` reports "double" | "single" | "none".

## (b) Stake certificates

```ts
client.newTx().registerStake({ stakeCredential, redeemer? })        // Conway RegCert — RUNS the script (publish purpose)
client.newTx().registerStakeLegacy({ stakeCredential, redeemer? })  // pre-Conway CDDL tag 0 — no witness needed
client.newTx().deregisterStake({ stakeCredential, redeemer? })      // UnregCert — also runs the publish handler
```

`setup` uses `registerStake` (the Conway certificate) with the script attached and a unit
redeemer, so the `publish` handler actually runs and registration is script-authorized.
`registerStakeLegacy` would work too — the handler admits registration unconditionally — but
it registers without ever executing the script.

`retire` uses `deregisterStake`. The gate's `publish` handler admits deregistration **only
when the compile-time `owner` param signed** (SPEC §3.1); it is not universally rejected —
that was the pre-2026-07-31 "permanent gate" design.

## (c) Reference-script output

```ts
client.newTx().payToAddress({
  address,
  assets, // Assets.fromLovelace(0n) is fine when autoMinUtxo bumps it
  datum, // new InlineDatum.InlineDatum({ data }) => inline datum on the output
  script, // => stored as the output's reference script
  autoMinUtxo: true,
});
```

- **`autoMinUtxo` defaults to OFF** — see `dist/sdk/builders/operations/Pay.js`, which resolves
  it as `params.autoMinUtxo ?? buildOptions.autoMinUtxo ?? false`. `setup` passes it per-call
  rather than computing min-ADA for a reference-script output by hand; without it, the
  0-lovelace output is invalid.

## (d) Zero withdrawal, reference inputs, signer, script attachment

```ts
tx.withdraw({ stakeCredential, amount: 0n, redeemer })  // docs: "amount: 0n to trigger stake validator (coordinator pattern)"
tx.readFrom({ referenceInputs: UTxO[] })                // reference inputs (also resolves scripts carried as scriptRef)
tx.collectFrom({ inputs: UTxO[], redeemer })            // spend inputs (script inputs need the script attached or referenced)
tx.addSigner({ keyHash })                               // required signer -> extra_signatories
tx.attachScript({ script })                             // inline script attachment (when no reference script)
tx.buildEffect({ changeAddress? })                      // omit changeAddress to fall back to the wallet's
```

## Never attachScript a script the tx already carries as a scriptRef (live-verified gotcha)

Spending a UTxO whose `scriptRef` holds the script **already supplies that script to the
ledger, for every purpose in the transaction** — Babbage onward resolves scripts from a
`scriptRef` on any input, spent or reference. Calling `attachScript` as well submits it twice
and the node rejects the whole tx:

```
ConwayUtxowFailure (ExtraneousScriptWitnessesUTXOW (NonEmptySet (fromList [ScriptHash "..."])))
```

`retire` hit exactly this on Preview (2026-07-31): it collects the reference-script UTxO and
also attached the gate script inline, reasoning that one `attachScript` would serve both the
`spend` and `publish` purposes. Wrong — dropping the call fixed it, and the retire tx then ran
both handlers off the collected UTxO's `scriptRef` alone (redeemers: `spend` + `cert`, same
script hash).

Rejection is **phase-1**, so nothing is consumed and no collateral is lost — but it is also
invisible to offline tests, which model builder calls rather than ledger witness rules.

## Reference inputs are excluded from coin selection (empirically verified gotcha)

`dist/sdk/builders/phases/Selection.js` (`getAvailableUtxos`) subtracts
`state.referenceInputs` from the selectable set. That is correct — Conway rejects a tx whose
inputs and reference inputs overlap — but it has a consequence for `withGate`: a holder whose
NFT **and** ADA sit in one UTxO has their whole balance removed from selection, and the build
fails with a generic coin-selection error rather than anything actionable.

`satisfies_gate` accepts spent inputs as well as reference inputs, so the escape hatch is to
`collectFrom` the proof UTxO instead of `readFrom`-ing it when it is the wallet's only funded
UTxO. Untested against a live network — confirm on Preview in M3.

## A failing script is refused in phase 1, not recorded in a block (live-verified)

Builder-produced transactions always carry `isValid = True`. If the node then finds a script
failing, that is a contradiction rather than an expected phase-2 failure, and the transaction is
refused outright:

```
ConwayUtxowFailure (UtxoFailure (UtxosFailure (ValidationTagMismatch (IsValid True)
  (FailedUnexpectedly (PlutusFailure "…")))))
```

It never enters a block and **no collateral is taken**. Landing a phase-2 failure on-chain would
require submitting with `isValid = False`, which the builder does not expose (`isValid` exists on
`Transaction` but there is no build option for it).

The upside: that refusal body carries the entire `PlutusFailure` — script hash, `ScriptInfo`
purpose, CEK evaluation error and full `TxInfo`. The provider's evaluate endpoint does not:
Blockfrost/Ogmios `EvaluateTx` returns `{"EvaluationFailure":{"ScriptFailures":{}}}`, a verdict
with an empty reasoning map. To learn _why_ a script failed, offer the transaction to the node
and read the rejection; to learn only _whether_ it failed, evaluate.
`examples/gate-adversarial` relies on both.

## Provider errors bury the ledger's objection (live-verified)

`Failed to submit transaction: Blockfrost submitTx failed` is three wrappers deep from anything
useful — the ledger's actual complaint sits in a nested `cause` chain
(`TransactionBuilderError` → `ProviderError` → `ResponseError`). Walk `cause` recursively before
concluding anything about a submit failure; see `describe` in
`examples/gate-adversarial/src/context.ts`.

## awaitTx confirms the tx, but the UTxO index lags (live-verified)

`setup` submits its registration, `awaitTx`es it, then builds the reference-script transaction —
and that second submit failed on Preview (2026-08-02) because coin selection picked an input the
registration had already spent. Blockfrost reports the transaction confirmed before its
address-UTxO index reflects it. An identical retry succeeded. Any two-transaction sequence that
spends from the same wallet needs to tolerate this, not just `awaitTx`.

## Client assembly & queries

```ts
import { Client, preview, preprod, mainnet } from "@evolution-sdk/evolution"; // Chain consts from sdk/client/Chain

Client.make(preview)
  .withBlockfrost({ baseUrl, projectId })   // or withKoios / withKupmios / withMaestro
  .withSeed({ mnemonic, accountIndex? })    // or withPrivateKey / withCip30 / withAddress
// order composes either way: make -> provider -> wallet, or make -> wallet -> provider
```

- `SigningClient.newTx() -> SigningTransactionBuilder`; `.build()` is Promise-based,
  `.buildEffect()` returns `Effect<SignBuilder, TransactionBuilderError | ...>`.
- Every client has `.effect` exposing the Effect-native API (use this in `setup`).
- Provider queries (on read-capable clients): `getUtxos(addressOrCredential)`,
  `getUtxosWithUnit(addressOrCredential, unit)`, `getUtxoByUnit(unit)`,
  `getUtxosByOutRef(inputs)`, `getProtocolParameters()`, `getDelegation(rewardAddress)`.
- Wallet: `getWalletUtxos()`, sign/submit via `SignBuilder`/`SubmitBuilder`.

## Reward account / credentials

```ts
Credential.makeScriptHash(hashBytes); // script credential from 28-byte hash
new RewardAccount.RewardAccount({ networkId, stakeCredential }); // NOT .make() — construct the class
RewardAccount.toBech32(account); // -> stake1... (networkId 1) / stake_test1... (networkId 0)
```

## MultiAsset maps are reference-keyed (empirically verified gotcha)

`Assets.tokens(assets, PolicyId.fromHex(hex))` and
`MultiAsset.getAssetsByPolicy(ma, PolicyId.fromHex(hex))` always return empty: the underlying
maps are keyed by class instance, so a freshly parsed `PolicyId`/`AssetName` never matches.
Iterate instead — `MultiAsset.getPolicyIds(ma)` and pass those same instances back in,
comparing via `PolicyId.toHex` (see `matchingQuantity` in `gate-proof.ts`).

## Errors

`TransactionBuilderError`, `EvaluationError`, `Wallet.WalletError`, `Provider.ProviderError` —
all `Data.TaggedError`-style; compose with our own tagged errors in Effect pipelines.
