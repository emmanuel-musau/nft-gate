use cardano/address.{Credential}
use cardano/transaction.{Transaction}

/// NFT Gate: a withdraw-zero validator parameterized by the company's NFT
/// policy ID. A DApp transaction passes the gate by including a zero-amount
/// withdrawal from this script's reward account.
///
/// TODO(M2): replace the `True` stub with the real check —
///   the transaction must reference (or spend) an input holding at least one
///   token under `company_policy`, and the wallet owning that input must have
///   signed the transaction (signer binding), so a holder cannot be spoofed.
validator gate(company_policy: ByteArray) {
  withdraw(_redeemer: Data, _account: Credential, _self: Transaction) {
    // Parameter is unused until M2; referencing it here keeps the compiler
    // quiet and makes the stub's intent explicit.
    company_policy == company_policy
  }

  else(_) {
    fail
  }
}
