//// Handler-level tests for the demo vault. The gate's own membership matrix is
//// tested in the `onchain/` project; these cover only the hook and the vault's
//// depositor rule.

use aiken/crypto.{ScriptHash}
use cardano/address.{Credential, Script, VerificationKey}
use cardano/transaction.{OutputReference, Transaction}
use vault.{VaultDatum}

const gate: ScriptHash =
  #"99999999999999999999999999999999999999999999999999999999"

const other_gate: ScriptHash =
  #"88888888888888888888888888888888888888888888888888888888"

const alice: ByteArray =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const mallory: ByteArray =
  #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

const some_oref: OutputReference =
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000000",
    output_index: 0,
  }

fn tx(
  withdrawal: Option<Credential>,
  signatories: List<ByteArray>,
) -> Transaction {
  let withdrawals = when withdrawal is {
    Some(credential) -> [Pair(credential, 0)]
    None -> []
  }
  Transaction {
    ..transaction.placeholder,
    withdrawals,
    extra_signatories: signatories,
  }
}

test spend_passes_for_depositor_with_gate_withdrawal() {
  vault.vault.spend(
    gate,
    Some(VaultDatum { owner: alice }),
    Void,
    some_oref,
    tx(Some(Script(gate)), [alice]),
  )
}

test spend_fails_without_gate_withdrawal() {
  !vault.vault.spend(
    gate,
    Some(VaultDatum { owner: alice }),
    Void,
    some_oref,
    tx(None, [alice]),
  )
}

test spend_fails_for_a_different_gates_withdrawal() {
  !vault.vault.spend(
    gate,
    Some(VaultDatum { owner: alice }),
    Void,
    some_oref,
    tx(Some(Script(other_gate)), [alice]),
  )
}

test spend_fails_for_key_withdrawal_reusing_the_gate_hash() {
  // A reward account under a *key* credential runs no script, so it must not
  // satisfy the hook even when the hash bytes match the gate's.
  !vault.vault.spend(
    gate,
    Some(VaultDatum { owner: alice }),
    Void,
    some_oref,
    tx(Some(VerificationKey(gate)), [alice]),
  )
}

test spend_fails_when_depositor_did_not_sign() {
  !vault.vault.spend(
    gate,
    Some(VaultDatum { owner: alice }),
    Void,
    some_oref,
    tx(Some(Script(gate)), [mallory]),
  )
}

test spend_fails_without_datum() {
  !vault.vault.spend(
    gate,
    None,
    Void,
    some_oref,
    tx(Some(Script(gate)), [alice]),
  )
}
