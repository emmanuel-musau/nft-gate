//// Handler-level tests for the gate validator. The full membership matrix
//// lives in `lib/gate/check.test.ak`.

use cardano/address.{Credential, Script}
use cardano/assets.{PolicyId}
use cardano/certificate.{
  DelegateBlockProduction, DelegateCredential, RegisterCredential,
  UnregisterCredential,
}
use cardano/transaction.{Input, NoDatum, Output, OutputReference, Transaction}
use gate.{GateDatum}

const policy: PolicyId =
  #"11111111111111111111111111111111111111111111111111111111"

const alice: ByteArray =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const owner: ByteArray =
  #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

const mallory: ByteArray =
  #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

const gate_hash: ByteArray =
  #"99999999999999999999999999999999999999999999999999999999"

const gate_account: Credential = Script(gate_hash)

const some_oref: OutputReference =
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000000",
    output_index: 0,
  }

fn signed_by(vkh: ByteArray) -> Transaction {
  Transaction { ..transaction.placeholder, extra_signatories: [vkh] }
}

fn holder_tx() -> Transaction {
  let proof = Input {
    output_reference: some_oref,
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
  gate.gate.withdraw(policy, "", 1, owner, Void, gate_account, holder_tx())
}

test withdraw_fails_when_holder_did_not_sign() {
  let tx = Transaction { ..holder_tx(), extra_signatories: [] }
  !gate.gate.withdraw(policy, "", 1, owner, Void, gate_account, tx)
}

test withdraw_fails_without_proof_utxo() {
  !gate.gate.withdraw(
    policy,
    "",
    1,
    owner,
    Void,
    gate_account,
    transaction.placeholder,
  )
}

test spend_passes_for_datum_owner() {
  let datum = Some(GateDatum { owner })
  gate.gate.spend(
    policy,
    "",
    1,
    owner,
    datum,
    Void,
    some_oref,
    signed_by(owner),
  )
}

test spend_fails_when_datum_owner_did_not_sign() {
  let datum = Some(GateDatum { owner })
  !gate.gate.spend(
    policy,
    "",
    1,
    owner,
    datum,
    Void,
    some_oref,
    signed_by(mallory),
  )
}

test spend_fails_without_datum() {
  !gate.gate.spend(
    policy,
    "",
    1,
    owner,
    None,
    Void,
    some_oref,
    signed_by(owner),
  )
}

test publish_allows_stake_registration() {
  let cert = RegisterCredential { credential: gate_account, deposit: Never }
  gate.gate.publish(policy, "", 1, owner, Void, cert, transaction.placeholder)
}

test publish_allows_owner_deregistration() {
  let cert = UnregisterCredential { credential: gate_account, refund: Never }
  gate.gate.publish(policy, "", 1, owner, Void, cert, signed_by(owner))
}

test publish_rejects_non_owner_deregistration() {
  let cert = UnregisterCredential { credential: gate_account, refund: Never }
  !gate.gate.publish(policy, "", 1, owner, Void, cert, signed_by(mallory))
}

test publish_rejects_deregistration_via_planted_datum() {
  // Planted-UTxO spoof: mallory spends a gate-address UTxO whose datum names
  // mallory. The spend passes (their own funds) but must not unlock dereg —
  // deregistration answers only to the compile-time owner.
  let planted = Input {
    output_reference: some_oref,
    output: Output {
      address: address.from_script(gate_hash),
      value: assets.from_lovelace(2_000_000),
      datum: transaction.InlineDatum(GateDatum { owner: mallory }),
      reference_script: None,
    },
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [planted],
    extra_signatories: [mallory],
  }
  let cert = UnregisterCredential { credential: gate_account, refund: Never }
  and {
    gate.gate.spend(
      policy,
      "",
      1,
      owner,
      Some(GateDatum { owner: mallory }),
      Void,
      some_oref,
      tx,
    ),
    !gate.gate.publish(policy, "", 1, owner, Void, cert, tx),
  }
}

test publish_rejects_delegation() {
  let cert = DelegateCredential {
    credential: gate_account,
    delegate: DelegateBlockProduction {
      stake_pool: #"77777777777777777777777777777777777777777777777777777777",
    },
  }
  !gate.gate.publish(policy, "", 1, owner, Void, cert, signed_by(owner))
}
