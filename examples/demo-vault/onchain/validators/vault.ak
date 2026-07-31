//// Demo consumer validator: a vault whose UTxOs are released to their depositor,
//// but only inside a transaction that also runs the gate (SPEC §7).
////
//// The whole integration is the `pairs.has_key(self.withdrawals, ...)` line: a
//// withdrawal from the gate's reward account forces the gate script to run, and
//// the gate is what proves NFT membership. This validator never inspects the
//// user's tokens — duplicating the membership check here would be a second,
//// divergeable copy of the rule. The gate script hash is a compile-time
//// parameter, so a vault is bound to exactly one gate.

use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{ScriptHash, VerificationKeyHash}
use cardano/address.{Script}
use cardano/transaction.{OutputReference, Transaction}

/// Inline datum on every vault UTxO, naming the depositor who may reclaim it.
pub type VaultDatum {
  owner: VerificationKeyHash,
}

validator vault(gate: ScriptHash) {
  spend(
    datum: Option<VaultDatum>,
    _redeemer: Data,
    _utxo: OutputReference,
    self: Transaction,
  ) {
    when datum is {
      Some(VaultDatum { owner }) -> and {
          pairs.has_key(self.withdrawals, Script(gate)),
          list.has(self.extra_signatories, owner),
        }
      None -> False
    }
  }

  else(_) {
    fail
  }
}
