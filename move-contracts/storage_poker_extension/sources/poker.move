module storage_poker_extension::poker;

use storage_poker_extension::config::{Self, AdminCap, XAuth, ExtensionConfig};
use sui::random::{Self, Random};
use sui::event;
use world::{
    character::Character,
    storage_unit::StorageUnit,
    inventory::{Self, Item}
};

// === Errors ===
#[error(code = 0)]
const EInvalidResourceType: vector<u8> = b"Invalid resource type deposited";
#[error(code = 1)]
const ENoPokerConfig: vector<u8> = b"Missing PokerConfig on ExtensionConfig";
#[error(code = 2)]
const EInvalidCardIndex: vector<u8> = b"Invalid card index to hold";
#[error(code = 3)]
const EWrongPlayer: vector<u8> = b"GameSession does not belong to this player";

// === Constants ===
const MAX_WIN_MULTIPLIER: u32 = 800;

// === Structs ===

public struct PokerConfig has drop, store {
    allowed_resource_types: vector<u64>,
}

public struct PokerConfigKey has copy, drop, store {}

public struct GameSession has key, store {
    id: UID,
    player: address,
    storage_unit_id: ID,
    cards: vector<u8>,
    stake: Item,
    max_win: Item,
}

public struct HandResolved has copy, drop {
    player: address,
    final_cards: vector<u8>,
    stake_amount: u64,
    multiplier: u64,
    payout_amount: u64
}

// === Admin Functions ===
public entry fun fund_house(
    _admin_cap: &AdminCap,
    storage_unit: &mut StorageUnit,
    character: &Character,
    funds: Item,
    ctx: &mut TxContext,
) {
    world::storage_unit::deposit_to_open_inventory<XAuth>(
        storage_unit,
        character,
        funds,
        config::x_auth(),
        ctx
    );
}
public fun set_poker_config(
    extension_config: &mut ExtensionConfig,
    admin_cap: &AdminCap,
    allowed_resource_types: vector<u64>,
) {
    extension_config.set_rule<PokerConfigKey, PokerConfig>(
        admin_cap,
        PokerConfigKey {},
        PokerConfig { allowed_resource_types },
    );
}

// === Gameplay Functions ===

public entry fun deposit_and_deal(
    extension_config: &ExtensionConfig,
    storage_unit: &mut StorageUnit,
    character: &Character,
    stake: Item,
    r: &Random,
    ctx: &mut TxContext,
) {
    assert!(extension_config.has_rule<PokerConfigKey>(PokerConfigKey {}), ENoPokerConfig);
    let poker_cfg = extension_config.borrow_rule<PokerConfigKey, PokerConfig>(PokerConfigKey {});

    assert!(vector::contains(&poker_cfg.allowed_resource_types, &inventory::type_id(&stake)), EInvalidResourceType);

    let stake_qty = inventory::quantity(&stake);
    let max_win_qty = stake_qty * MAX_WIN_MULTIPLIER;

    // Withdraw the max win amount upfront to ensure the private storage can pay out
    // If it can't, this will abort with EInventoryInsufficientQuantity
    let max_win = world::storage_unit::withdraw_item<XAuth>(
        storage_unit,
        character,
        config::x_auth(),
        inventory::type_id(&stake),
        max_win_qty,
        ctx
    );

    let mut generator = random::new_generator(r, ctx);
    
    let current_cards: vector<u8> = vector::empty();
    let cards = deal_unique_cards(&current_cards, 5, &mut generator);

    let session = GameSession {
        id: object::new(ctx),
        player: ctx.sender(),
        storage_unit_id: object::id(storage_unit),
        cards,
        stake,
        max_win,
    };

    transfer::transfer(session, ctx.sender());
}

public entry fun draw_and_resolve(
    extension_config: &ExtensionConfig,
    session: GameSession,
    storage_unit: &mut StorageUnit,
    character: &Character,
    held_indices: vector<u8>,
    r: &Random,
    ctx: &mut TxContext,
) {
    assert!(extension_config.has_rule<PokerConfigKey>(PokerConfigKey {}), ENoPokerConfig);

    assert!(session.player == ctx.sender(), EWrongPlayer);
    assert!(session.storage_unit_id == object::id(storage_unit), EWrongPlayer);

    let mut generator = random::new_generator(r, ctx);
    
    // Validate hold indices and setup new hand
    let mut final_cards: vector<u8> = vector::empty();
    let mut i = 0;
    while (i < vector::length(&held_indices)) {
        let idx = *vector::borrow(&held_indices, i);
        assert!(idx < 5, EInvalidCardIndex);
        vector::push_back(&mut final_cards, *vector::borrow(&session.cards, (idx as u64)));
        i = i + 1;
    };

    let cards_needed = 5 - vector::length(&final_cards);
    let new_cards = deal_unique_cards(&final_cards, (cards_needed as u8), &mut generator);
    
    vector::append(&mut final_cards, new_cards);
    let eval_cards = final_cards; // copy for eval

    let multiplier = evaluate_hand(&eval_cards);
    
    let GameSession { id, player, storage_unit_id: _, cards: _, stake, max_win } = session;
    id.delete();
    
    let stake_qty = inventory::quantity(&stake);
    let stake_type = inventory::type_id(&stake);

    // Deposit everything back to house (private storage)
    world::storage_unit::deposit_item<XAuth>(
        storage_unit,
        character,
        stake,
        config::x_auth(),
        ctx
    );
    world::storage_unit::deposit_item<XAuth>(
        storage_unit,
        character,
        max_win,
        config::x_auth(),
        ctx
    );

    if (multiplier > 0) {
        // Player wins
        let win_qty = stake_qty * (multiplier as u32);
        let payout_amount = stake_qty + win_qty;
        let payout = world::storage_unit::withdraw_item<XAuth>(
            storage_unit,
            character,
            config::x_auth(),
            stake_type,
            payout_amount,
            ctx
        );

        event::emit(HandResolved {
            player,
            final_cards: eval_cards,
            stake_amount: (stake_qty as u64),
            multiplier,
            payout_amount: (payout_amount as u64)
        });

        transfer::public_transfer(payout, player);
    } else {
        event::emit(HandResolved {
            player,
            final_cards: eval_cards,
            stake_amount: (stake_qty as u64),
            multiplier: 0,
            payout_amount: 0
        });
    }
}

// === Internal Helpers ===

fun deal_unique_cards(
    existing: &vector<u8>,
    count: u8,
    generator: &mut sui::random::RandomGenerator
): vector<u8> {
    let mut new_cards = vector::empty<u8>();
    let mut i = 0;
    while (i < count) {
        let card = random::generate_u8_in_range(generator, 0, 51);
        if (!vector::contains(existing, &card) && !vector::contains(&new_cards, &card)) {
            vector::push_back(&mut new_cards, card);
            i = i + 1;
        };
    };
    new_cards
}

public fun evaluate_hand(cards: &vector<u8>): u64 {
    let mut values = vector::empty<u8>();
    let mut suits = vector::empty<u8>();
    let mut i = 0;
    while (i < 5) {
        let c = *vector::borrow(cards, i);
        vector::push_back(&mut values, c % 13);
        vector::push_back(&mut suits, c / 13);
        i = i + 1;
    };
    
    sort_asc(&mut values);
    
    let is_flush = is_all_same(&suits);
    let mut is_straight = is_consecutive(&values);
    
    if (!is_straight && *vector::borrow(&values, 0) == 0 && *vector::borrow(&values, 1) == 1 && *vector::borrow(&values, 2) == 2 && *vector::borrow(&values, 3) == 3 && *vector::borrow(&values, 4) == 12) {
        is_straight = true; // Special case for A-2-3-4-5
    };
    
    if (is_flush && is_straight) {
        if (*vector::borrow(&values, 0) == 8 && *vector::borrow(&values, 4) == 12) {
            return 800 // Royal flush: 10, J, Q, K, A (8, 9, 10, 11, 12)
        } else {
            return 50 // Straight flush
        }
    };
    
    let counts = get_counts(&values);
    
    let c0 = *vector::borrow(&counts, 0);
    if (c0 == 4) return 25;
    if (c0 == 3 && vector::length(&counts) > 1 && *vector::borrow(&counts, 1) == 2) return 9;
    if (is_flush) return 6;
    if (is_straight) return 4;
    if (c0 == 3) return 3;
    if (c0 == 2 && vector::length(&counts) > 1 && *vector::borrow(&counts, 1) == 2) return 2;
    if (c0 == 2) {
        let pair_val = get_pair_value(&values);
        // Jacks = 9 (value is 0-indexed where 0=2, 8=10, 9=J)
        if (pair_val >= 9) return 1;
    };
    
    0
}

fun sort_asc(v: &mut vector<u8>) {
    let mut i = 0;
    while (i < 5) {
        let mut j = 0;
        while (j < 4 - i) {
            let a = *vector::borrow(v, j);
            let b = *vector::borrow(v, j + 1);
            if (a > b) {
                *vector::borrow_mut(v, j) = b;
                *vector::borrow_mut(v, j + 1) = a;
            };
            j = j + 1;
        };
        i = i + 1;
    };
}

fun is_all_same(v: &vector<u8>): bool {
    let first = *vector::borrow(v, 0);
    let mut i = 1;
    while (i < 5) {
        if (*vector::borrow(v, i) != first) return false;
        i = i + 1;
    };
    true
}

fun is_consecutive(v: &vector<u8>): bool {
    let mut i = 0;
    while (i < 4) {
        if (*vector::borrow(v, i + 1) != *vector::borrow(v, i) + 1) return false;
        i = i + 1;
    };
    true
}

fun get_counts(values: &vector<u8>): vector<u8> {
    let mut counts = vector::empty<u8>();
    if (vector::length(values) == 0) return counts;
    
    let mut current_val = *vector::borrow(values, 0);
    let mut current_count = 1;
    let mut i = 1;
    while (i < 5) {
        let val = *vector::borrow(values, i);
        if (val == current_val) {
            current_count = current_count + 1;
        } else {
            vector::push_back(&mut counts, current_count);
            current_val = val;
            current_count = 1;
        };
        i = i + 1;
    };
    vector::push_back(&mut counts, current_count);
    sort_desc(&mut counts);
    counts
}

fun sort_desc(v: &mut vector<u8>) {
    let len = vector::length(v);
    let mut i = 0;
    while (i < len) {
        let mut j = 0;
        while (j < len - 1 - i) {
            let a = *vector::borrow(v, j);
            let b = *vector::borrow(v, j + 1);
            if (a < b) {
                *vector::borrow_mut(v, j) = b;
                *vector::borrow_mut(v, j + 1) = a;
            };
            j = j + 1;
        };
        i = i + 1;
    };
}

fun get_pair_value(values: &vector<u8>): u8 {
    let mut i = 0;
    while (i < 4) {
        if (*vector::borrow(values, i) == *vector::borrow(values, i + 1)) {
            return *vector::borrow(values, i)
        };
        i = i + 1;
    };
    0
}
