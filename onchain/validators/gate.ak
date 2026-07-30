//// Withdraw-zero gate, parameterized per project (SPEC §3.1). A DApp
//// transaction passes by including a zero-amount withdrawal from this
//// script's reward account, which runs the membership check once per tx.
//// Registration passes so setup works with either certificate style;
//// deregistration and delegation fail so the gate is permanent and its
//// reward balance stays zero (a non-zero balance would invalidate the
//// zero-withdrawal trigger).

use cardano/address.{Credential}
use cardano/assets.{AssetName, PolicyId}
use cardano/certificate.{Certificate, RegisterCredential}
use cardano/transaction.{Transaction}
use gate/check

validator gate(
  asset_policy: PolicyId,
  asset_name_prefix: AssetName,
  min_quantity: Int,
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

  publish(_redeemer: Data, certificate: Certificate, _self: Transaction) {
    when certificate is {
      RegisterCredential { .. } -> True
      _ -> False
    }
  }

  else(_) {
    fail
  }
}
