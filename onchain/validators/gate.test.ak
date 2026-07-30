//// Handler-level tests for the gate validator. The full membership matrix
//// lives in `lib/gate/check.test.ak`.

use cardano/address.{Credential, Script}
use cardano/assets.{PolicyId}
use cardano/certificate.{
  DelegateBlockProduction, DelegateCredential, RegisterCredential,
  UnregisterCredential,
}
use cardano/transaction.{Input, NoDatum, Output, OutputReference, Transaction}
use gate

const policy: PolicyId =
  #"11111111111111111111111111111111111111111111111111111111"

const alice: ByteArray =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const gate_account: Credential =
  Script(#"99999999999999999999999999999999999999999999999999999999")

fn holder_tx() -> Transaction {
  let proof = Input {
    output_reference: OutputReference {
      transaction_id: #"0000000000000000000000000000000000000000000000000000000000000000",
      output_index: 0,
    },
    output: Output {
      address: address.from_verification_key(alice),
      value: assets.from_lovelace(2_000_000) |> assets.add(policy, "vip", 1),
      datum: NoDatum,
      reference_script: None,
    },
  }
  Transaction {
    ..transaction.placeholder,
    reference_inputs: [proof],
    extra_signatories: [alice],
  }
}

test withdraw_passes_for_signing_holder() {
  gate.gate.withdraw(policy, "", 1, Void, gate_account, holder_tx())
}

test withdraw_fails_when_holder_did_not_sign() {
  let tx = Transaction { ..holder_tx(), extra_signatories: [] }
  !gate.gate.withdraw(policy, "", 1, Void, gate_account, tx)
}

test withdraw_fails_without_proof_utxo() {
  !gate.gate.withdraw(
    policy,
    "",
    1,
    Void,
    gate_account,
    transaction.placeholder,
  )
}

test publish_allows_stake_registration() {
  let cert = RegisterCredential { credential: gate_account, deposit: Never }
  gate.gate.publish(policy, "", 1, Void, cert, transaction.placeholder)
}

test publish_rejects_deregistration() {
  let cert = UnregisterCredential { credential: gate_account, refund: Never }
  !gate.gate.publish(policy, "", 1, Void, cert, transaction.placeholder)
}

test publish_rejects_delegation() {
  let cert = DelegateCredential {
    credential: gate_account,
    delegate: DelegateBlockProduction {
      stake_pool: #"77777777777777777777777777777777777777777777777777777777",
    },
  }
  !gate.gate.publish(policy, "", 1, Void, cert, transaction.placeholder)
}
