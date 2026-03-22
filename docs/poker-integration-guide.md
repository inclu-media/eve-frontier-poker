# EVE Frontier: Poker DApp Build Flow & Architecture

This document outlines the end-to-end integration and build pipeline for the EVE Frontier Poker DApp, chronicling the transition from Move smart contract logic up to the frontend UI deployment.

## 1. Smart Contract Deployment (Move)
The core logic resides in the `poker.move` smart assembly. Deployment to the Sui Network (Localnet or Testnet) must be done first.

1. Navigate to the contract directory and build the assembly using the Sui CLI:
   ```bash
   cd move-contracts/storage_poker_extension
   sui move build
   ```
2. Publish the package to your active network:
   * **Localnet:**  
     ```bash
     sui client test-publish --build-env testnet --pubfile-path ../../deployments/localnet/Pub.localnet.toml
     ```
   * **Testnet:**  
     ```bash
     sui client switch --env official-testnet
     sui client publish
     ```
     *(Note: We specifically override the environment config and use the unflagged proxy to bypass strict Sui TOML regex parsers for testnet aliases).*
3. Upon deployment, record the resulting **Package ID** and the **PokerConfig Object ID** created by the initialization function.

## 2. Environment Variables (`.env`)
Both the TypeScript scripts and the frontend DApp require access to the deployed object constraints. These are synchronized via `.env` files.

### Root Workspace `.env` (For TS Scripts)
```env
SUI_URL=https://fullnode.testnet.sui.io:443
PACKAGE_ID=<Deployed Poker Package ID>
POKER_CONFIG_ID=<Created PokerConfig Object ID>
STORAGE_UNIT_ID=<Your initialized Storage Unit Object ID>
```

### DApp Environment `dapps/.env` (For Frontend GUI)
```env
VITE_SUI_RPC_URL=https://fullnode.testnet.sui.io:443
VITE_BUILDER_SCENE_PACKAGE_ID=<Deployed Poker Package ID>
VITE_POKER_EXTENSION_CONFIG_ID=<Created PokerConfig Object ID>
VITE_STORAGE_UNIT_ID=<Your initialized Storage Unit Object ID>
VITE_CHARACTER_ID=<Your Game Character Object ID>
```

## 3. Initialization Scripts Order (`ts-scripts/storage_poker_extension/`)
A suite of TypeScript logic scripts exists to bridge the bare metal deployment into a playable state. You MUST execute these sequentially via `pnpm tsx` to seed the world state and configure the smart contract before launching the DApp.

### Step 1: Configure Rules & Authorize
*   **Command:** `pnpm tsx ts-scripts/storage_poker_extension/poker-flow.ts`
*   **Purpose:** Executes the Admin `set_poker_config` module on the newly deployed Config Object to explicitly whitelist valid Fuel type-IDs. It then officially authorizes your Storage Unit to be acted upon via the Poker Extension framework.

### Step 2: Initialize House Bank Storage
*   **Command:** `pnpm tsx ts-scripts/storage_poker_extension/fund-house.ts`
*   **Purpose:** Creates a physical EVE Storage Unit and locks initial house liquidity inside it so that the contract can mathematically guarantee House payouts during the `max_win` fund check. This requires the framework authorization from Step 1.
*   **Action:** Copy the resulting `STORAGE_UNIT_ID` to your root and `/dapps` `.env` files.

### Step 3: Seed Player Stakes
*   **Command:** `pnpm tsx ts-scripts/storage_poker_extension/deposit-stake.ts`
*   **Purpose:** Simulates the manual player action of depositing physical Fuel items directly into the Storage Unit's active inventory. Because the Poker DApp now safely reads directly from the Storage Unit rather than sweeping the player's wallet, this script seeds the storage with valid fuel stacks to allow you to interact with the frontend's Stake Dropdown selector without actually needing to mine in-game.

### Step 4: Verify Balances (Optional)
*   **Command:** `pnpm tsx ts-scripts/storage_poker_extension/check-funds.ts`
*   **Purpose:** A diagnostic verification tool that queries the live SUI network to map the specific Resource Quantities currently escrowed in the Storage Unit. It distinctly separates and tallies the House Funds (Open Inventory mapped via `fund-house.ts`) against the Player Stakes (Regular Inventory mapped via `deposit-stake.ts`).

### Step 5: Defund House (Optional/Cleanup)
*   **Command:** `pnpm tsx ts-scripts/storage_poker_extension/defund-house.ts`
*   **Purpose:** Sweeps all trapped liquidity (House Funds) from the Storage Unit's open inventory back into the Admin Wallet. Useful for clean slate testing or reclaiming funds.

### Step 6: Empty Player Storage (Optional/Cleanup)
*   **Command:** `pnpm tsx ts-scripts/storage_poker_extension/empty-storage.ts`
*   **Purpose:** Sweeps all specific Player stakes from their regular inventory partition in the Storage Unit, throwing the extracted fuel into a void address, effectively restoring the storage unit to absolute zero liquidity. Useful for clearing out residue before new testing rounds.

## 4. DApp Frontend Integration
Once the Smart Assembly is published, environmental variables are synced, and the House Storage is funded:
1. Navigate to the `/dapps` directory.
2. Install dependencies via `pnpm install` (or your preferred package manager).
3. The core layout logic resides inside `src/PokerTable.tsx`, which queries the User Wallet for valid Fuel types and broadcasts the active `deposit_and_deal` transactions back to the Move backend.
4. Launch the local development server:
   ```bash
   pnpm run dev
   ```
5. Interface with the app via the configured localhost port, connecting your Sui testnet wallet to play.
