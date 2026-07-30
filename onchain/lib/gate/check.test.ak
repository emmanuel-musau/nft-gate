//// Adversarial test matrix for the membership check (SPEC §11 N3). Every
//// fail case here is an attack that must stay closed.

use aiken/primitive/bytearray
use cardano/address.{Address, Script}
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{Input, NoDatum, Output, OutputReference}
use gate/check

const asset_policy: PolicyId =
  #"11111111111111111111111111111111111111111111111111111111"

const other_policy: PolicyId =
  #"22222222222222222222222222222222222222222222222222222222"

const alice: ByteArray =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const bob: ByteArray =
  #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

const some_script: ByteArray =
  #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

/// CIP-68 asset-name labels: (222) user token, (100) reference token.
const label_222: AssetName = #"000de140"

const label_100: AssetName = #"000643b0"

const any_name: AssetName = ""

fn utxo(at: Address, value: Value) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"0000000000000000000000000000000000000000000000000000000000000000",
      output_index: 0,
    },
    output: Output {
      address: at,
      value,
      datum: NoDatum,
      reference_script: None,
    },
  }
}

fn holding_named(
  owner: ByteArray,
  policy: PolicyId,
  name: AssetName,
  quantity: Int,
) -> Input {
  utxo(
    address.from_verification_key(owner),
    assets.from_lovelace(2_000_000) |> assets.add(policy, name, quantity),
  )
}

fn holding(owner: ByteArray, policy: PolicyId, quantity: Int) -> Input {
  holding_named(owner, policy, "vip", quantity)
}

fn plain(owner: ByteArray) -> Input {
  utxo(address.from_verification_key(owner), assets.from_lovelace(2_000_000))
}

test passes_when_reference_input_holds_token_and_owner_signed() {
  check.satisfies_gate(
    [holding(alice, asset_policy, 1)],
    [],
    [alice],
    asset_policy,
    any_name,
    1,
  )
}

test passes_when_spent_input_holds_token_and_owner_signed() {
  check.satisfies_gate(
    [],
    [holding(alice, asset_policy, 1)],
    [alice],
    asset_policy,
    any_name,
    1,
  )
}

test passes_at_exact_quantity_threshold() {
  check.satisfies_gate(
    [holding(alice, asset_policy, 1000)],
    [],
    [alice],
    asset_policy,
    any_name,
    1000,
  )
}

test passes_summing_asset_names_within_one_utxo() {
  let proof = utxo(
    address.from_verification_key(alice),
    assets.from_lovelace(2_000_000)
      |> assets.add(asset_policy, "gold", 600)
      |> assets.add(asset_policy, "silver", 400),
  )
  check.satisfies_gate([proof], [], [alice], asset_policy, any_name, 1000)
}

test passes_when_other_unqualified_utxos_are_present() {
  let refs = [
    holding(bob, asset_policy, 1),
    holding(alice, other_policy, 1),
    holding(alice, asset_policy, 1),
  ]
  check.satisfies_gate(refs, [], [alice], asset_policy, any_name, 1)
}

test fails_when_no_token_anywhere() {
  !check.satisfies_gate(
    [plain(alice)],
    [plain(alice)],
    [alice],
    asset_policy,
    any_name,
    1,
  )
}

test fails_when_holder_did_not_sign() {
  !check.satisfies_gate(
    [holding(alice, asset_policy, 1)],
    [],
    [bob],
    asset_policy,
    any_name,
    1,
  )
}

test fails_when_nobody_signed() {
  !check.satisfies_gate(
    [holding(alice, asset_policy, 1)],
    [],
    [],
    asset_policy,
    any_name,
    1,
  )
}

test fails_with_wrong_policy() {
  !check.satisfies_gate(
    [holding(alice, other_policy, 1)],
    [],
    [alice],
    asset_policy,
    any_name,
    1,
  )
}

test fails_below_quantity_threshold() {
  !check.satisfies_gate(
    [holding(alice, asset_policy, 999)],
    [],
    [alice],
    asset_policy,
    any_name,
    1000,
  )
}

test fails_when_quantity_split_across_utxos() {
  let refs = [
    holding(alice, asset_policy, 500),
    holding(alice, asset_policy, 500),
  ]
  !check.satisfies_gate(refs, refs, [alice], asset_policy, any_name, 1000)
}

test fails_when_token_is_script_owned() {
  let locked = utxo(
    Address { payment_credential: Script(some_script), stake_credential: None },
    assets.from_lovelace(2_000_000) |> assets.add(asset_policy, "vip", 1),
  )
  !check.satisfies_gate(
    [locked],
    [locked],
    [alice, bob],
    asset_policy,
    any_name,
    1,
  )
}

test fails_on_empty_transaction() {
  !check.satisfies_gate([], [], [alice], asset_policy, any_name, 1)
}

test passes_with_matching_name_prefix() {
  check.satisfies_gate(
    [holding_named(alice, asset_policy, "vip", 1)],
    [],
    [alice],
    asset_policy,
    "vip",
    1,
  )
}

test fails_with_wrong_name_prefix() {
  !check.satisfies_gate(
    [holding_named(alice, asset_policy, "vip", 1)],
    [],
    [alice],
    asset_policy,
    "gold",
    1,
  )
}

test passes_in_exact_name_mode() {
  let name = #"000de140" |> bytearray.concat("member")
  check.satisfies_gate(
    [holding_named(alice, asset_policy, name, 1)],
    [],
    [alice],
    asset_policy,
    name,
    1,
  )
}

test cip68_prefix_admits_user_token_only() {
  let user_token = holding_named(
    alice,
    asset_policy,
    label_222 |> bytearray.concat("m1"),
    1,
  )
  let ref_token = holding_named(
    alice,
    asset_policy,
    label_100 |> bytearray.concat("m1"),
    1,
  )
  and {
    check.satisfies_gate([user_token], [], [alice], asset_policy, label_222, 1),
    !check.satisfies_gate([ref_token], [], [alice], asset_policy, label_222, 1),
  }
}

test prefix_scopes_quantity_within_one_utxo() {
  let mixed = utxo(
    address.from_verification_key(alice),
    assets.from_lovelace(2_000_000)
      |> assets.add(asset_policy, "gold", 600)
      |> assets.add(asset_policy, "silver", 400),
  )
  and {
    check.satisfies_gate([mixed], [], [alice], asset_policy, "gold", 600),
    !check.satisfies_gate([mixed], [], [alice], asset_policy, "gold", 1000),
  }
}

test zero_threshold_still_requires_one_token() {
  !check.satisfies_gate([plain(alice)], [], [alice], asset_policy, any_name, 0)
}

test negative_threshold_still_requires_one_token() {
  !check.satisfies_gate([plain(alice)], [], [alice], asset_policy, any_name, -5)
}

test clamped_threshold_passes_with_one_token() {
  check.satisfies_gate(
    [holding(alice, asset_policy, 1)],
    [],
    [alice],
    asset_policy,
    any_name,
    0,
  )
}

test quantity_sums_across_matching_names() {
  let value = assets.from_lovelace(5)
    |> assets.add(asset_policy, "a1", 3)
    |> assets.add(asset_policy, "a2", 4)
    |> assets.add(asset_policy, "b1", 9)
    |> assets.add(other_policy, "a1", 100)
  and {
    check.quantity_matching(value, asset_policy, any_name) == 16,
    check.quantity_matching(value, asset_policy, "a") == 7,
  }
}

test quantity_is_zero_for_absent_policy() {
  check.quantity_matching(assets.from_lovelace(5), asset_policy, any_name) == 0
}
