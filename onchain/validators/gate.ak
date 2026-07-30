//// Withdraw-zero gate, parameterized per project (SPEC §3.1). A DApp
//// transaction passes by including a zero-amount withdrawal from this
//// script's reward account, which runs the membership check once per tx.
////
//// The gate is owner-retirable (revised 2026-07-31): `spend` releases the
//// reference-script UTxO to whoever its inline GateDatum names, and `publish`
//// lets the compile-time `owner` deregister to reclaim the stake deposit.
//// The datum only ever authorizes spending its own UTxO — never the
//// deregistration — because anyone can create gate-address UTxOs with
//// arbitrary datums. Delegation stays forbidden so the reward balance is
//// always zero and the zero-withdrawal trigger stays valid; a retire tx must
//// not withdraw, since the withdraw handler runs the membership check.

use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Credential}
use cardano/assets.{AssetName, PolicyId}
use cardano/certificate.{Certificate, RegisterCredential, UnregisterCredential}
use cardano/transaction.{OutputReference, Transaction}
use gate/check

/// Inline datum on the reference-script UTxO written by setup.
pub type GateDatum {
  owner: VerificationKeyHash,
}

validator gate(
  asset_policy: PolicyId,
  asset_name_prefix: AssetName,
  min_quantity: Int,
  owner: VerificationKeyHash,
) {
  withdraw(_redeemer: Data, _account: Credential, self: Transaction) {
    check.satisfies_gate(
      self.reference_inputs,
      self.inputs,
      self.extra_signatories,
      asset_policy,
      asset_name_prefix,
      min_quantity,
    )
  }

  spend(
    datum: Option<GateDatum>,
    _redeemer: Data,
    _utxo: OutputReference,
    self: Transaction,
  ) {
    when datum is {
      Some(GateDatum { owner: utxo_owner }) ->
        list.has(self.extra_signatories, utxo_owner)
      None -> False
    }
  }

  publish(_redeemer: Data, certificate: Certificate, self: Transaction) {
    when certificate is {
      RegisterCredential { .. } -> True
      UnregisterCredential { .. } -> list.has(self.extra_signatories, owner)
      _ -> False
    }
  }

  else(_) {
    fail
  }
}
