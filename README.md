# BURN::RATE Fuel Poker
### EVE Frontier × Sui Hackathon 2026

This document outlines the final streamlined pipeline for compiling the Poker smart contract, linking it to the Canonical EVE World, and deploying the React DApp.

## 1. Smart Contract Deployment (Move)

The core logic resides in the `poker.move` smart assembly. You must deploy your contract to the Sui Canonical Testnet to interact identically with native EVE items and characters.

1. Navigate to the contract directory and build the assembly using the Sui CLI:
   ```bash
   sui client switch --env testnet
   cd move-contracts/storage_poker_extension
   sui move build
   ```
2. Publish the package specifically targeting the `testnet` environment:
   If necessary, delete Published.toml first.
   ```bash
   sui client publish
   ```
3. Upon deployment, record the resulting **Package ID** and the **ExtensionConfig ID** created by the initialization function.
4. **Update Environment Variables:** Immediately paste these two Object IDs into your `.env` files.
5. **Whitelist Fuels:** You must configure the `PokerConfig` to whitelist acceptable fuel bindings. Run the configuration script from the root directory:
   ```bash
   npx tsx ts-scripts/storage_poker_extension/configure-rules.ts
   ```
6. **Re-authorize DApp:** If you have just re-published the contract to update it, you **must** open the DApp in your browser and click **AUTHORIZE DAPP** again to grant permissions to the new package.

## 2. Environment Variables (`dapps/.env`)

The frontend DApp requires explicit references to both your newly deployed logic objects and the Canonical EVE World system variables. 

Create or update your `.env` file inside the `/dapps` directory:
```env
VITE_SUI_RPC_URL=https://fullnode.testnet.sui.io:443
VITE_EVE_WORLD_PACKAGE_ID=0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75

VITE_BUILDER_SCENE_PACKAGE_ID=<Your Deployed Poker Package ID>
VITE_POKER_EXTENSION_CONFIG_ID=<Your ExtensionConfig Object ID>

VITE_STORAGE_UNIT_ID=<Your Target Smart Assembly / Storage Unit Object ID>
VITE_CHARACTER_ID=<Your Game Character Object ID Fallback>
```

## 3. DApp Initialization & Local Deployment

All administrative operations (Authorizing, Funding, and Defunding) have been migrated entirely into the React UI natively mimicking the behavior of the EVE Smart Assembly. Terminal scripts are no longer required to manage physical game states.

1. Navigate to the `/dapps` directory.
2. Install dependencies via `pnpm install` (or your preferred manager).
3. Launch the local development server:
   ```bash
   pnpm run dev
   ```
4. **Initial Authorization:** 
   Connect your owning wallet in the local browser. The DApp's **Admin Console** will become visible. Click **AUTHORIZE DAPP** to natively link your physical Storage Unit to the custom Poker contract logic.
5. **Fund the House:**
   Once authorized, your Player Inventory will load. Click **FUND HOUSE** next to any valid fuel type to lock it into the Open Inventory to bankroll the smart contract. You can reclaim these at any time using **DEFUND**.

## 4. Vercel Web Deployment

The Poker DApp is optimized to overlay flush within the Utopia client iframe without scrolling clips. 

1. **Automatic Deployments:** Because the project is tracked by Git, Vercel will automatically trigger a new build whenever you `git push` to `main`.
2. **Environment Synchronization:** You **MUST** strictly copy all variables from your `dapps/.env` file directly into Vercel's Project Settings. If these Canonical IDs are omitted on tracking, the production build will fail to execute Web3 calls.
3. **Live Injection:** Your Vercel domain URL can now be directly embedded into any initialized EVE Smart Assembly within the Utopia desktop client.

## 5. Known UI Integration Quirks (Hackathon Judges Info)

When using the Storage Unit as the physical backend for this extension, you may notice that the open inventory (house fund) and your personal inventory visually intermix within the EVE Frontier game client. 

This occurs because both regular deposits (`deposit_item`) and hidden escrow deposits (`deposit_to_open_inventory`) fire the exact same `ItemDepositedEvent` at the core primitive level. The game client currently cannot distinguish which internal storage key received the items, so it eagerly renders all deposits into the visible regular storage interface.

This incorrect display is purely a frontend visual artifact and does not affect the actual on-chain security of the funds. The display will persist until you close the smart assembly interface (ESC) and reopen it (F) to force a hard state synchronization.
