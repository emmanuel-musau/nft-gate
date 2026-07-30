//// Core membership check shared by both integration modes: the withdraw-zero
//// validator wraps `satisfies_gate`; embedded mode calls it directly. This is
//// the sole on-chain enforcement — anything the SDK checks is UX only.

use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/math
use aiken/primitive/bytearray
use cardano/address.{Script, VerificationKey}
use cardano/assets.{AssetName, PolicyId, Value, tokens}
use cardano/transaction.{Input}

/// Total quantity held under `policy` across asset names starting with
/// `name_prefix`. An empty prefix matches every name.
pub fn quantity_matching(
  value: Value,
  policy: PolicyId,
  name_prefix: AssetName,
) -> Int {
  dict.foldl(
    tokens(value, policy),
    0,
    fn(name, quantity, total) {
      if bytearray.starts_with(name, name_prefix) {
        total + quantity
      } else {
        total
      }
    },
  )
}

/// Passes iff a single UTxO among `reference_inputs` or spent `inputs` holds
/// at least `max(min_quantity, 1)` tokens under `asset_policy` whose names
/// start with `asset_name_prefix` — per UTxO, never summed across UTxOs —
/// and its VerificationKey owner signed the transaction.
///
/// The prefix scopes the gate within a policy (e.g. CIP-68 user-token label,
/// or a full name for a single-beacon gate); it is not a defense against a
/// compromised policy, since minters choose asset names. The quantity clamp
/// stops a threshold ≤ 0 from admitting everyone; signer binding stops
/// someone else's token UTxO from being borrowed, which also means
/// script-owned UTxOs never qualify.
pub fn satisfies_gate(
  reference_inputs: List<Input>,
  inputs: List<Input>,
  extra_signatories: List<VerificationKeyHash>,
  asset_policy: PolicyId,
  asset_name_prefix: AssetName,
  min_quantity: Int,
) -> Bool {
  let threshold = math.max(min_quantity, 1)
  let qualifies = fn(input: Input) {
    quantity_matching(input.output.value, asset_policy, asset_name_prefix) >= threshold && when
      input.output.address.payment_credential
    is {
      VerificationKey(vkh) -> list.has(extra_signatories, vkh)
      Script(_) -> False
    }
  }
  list.any(reference_inputs, qualifies) || list.any(inputs, qualifies)
}
