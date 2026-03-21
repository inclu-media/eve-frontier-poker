# Storage Poker Smart Assembly Extension

A custom builder extension for EVE Frontier that transforms a Storage Unit into a one-player Draw Poker mini-game. 

Players deposit a configured type of resource. The extension automatically verifies that the storage unit's private reserves hold enough of that resource to pay out the maximum possible win (Royal Flush is 800x the stake). The player is dealt cards, chooses which ones to hold, draws substitutes, and receives their payout dynamically via the assembly's open inventory!

## Required Steps for Setup

1. **Deploy the Extension:**
   From `/workspace/builder-scaffold/move-contracts/storage_poker_extension`:
   ```bash
   sui move build
   ```
   Deploy using standard process or your testing frameworks `publish` commands, exporting the objects to `.env` as follows:
   ```
   BUILDER_SCENE_PACKAGE_ID=...
   POKER_ADMIN_CAP_ID=...
   POKER_EXTENSION_CONFIG_ID=...
   ```

2. **Run TypeScript Tests:**
   Using the `builder-scaffold` structure, ensure your local node or testnet is running and configured correctly in your `.env`.
   
   Execute the test script to authorize the Storage Unit and set the Poker Rules:
   ```bash
   npx tsx ts-scripts/storage_poker_extension/poker-flow.ts
   ```

## Using the Poker API

Inside the EVE Frontier Game or via PTB integration (frontend / bot scripts):

1. Submit a `deposit_and_deal` transaction taking standard arguments along with the `sui::random::Random` object (0x8) and your stake `Item`. Your stake will be validated and a `GameSession` object will be created and transferred to you containing the initial 5 cards.
2. Review the `cards` field on your `GameSession` object (0-51 layout: suit * 13 + value).
3. Submit a `draw_and_resolve` transaction, providing your `held_indices` (e.g., `vector[0, 2]`) to swap unheld cards.
4. If you win, the payout and your original stake are sent to the open Storage Unit inventory layer where you can withdraw them in-game! If you lose, they are pushed to the Assembly owner's private storage vault.
