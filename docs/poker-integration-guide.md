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
     sui client publish -e testnet
     ```
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
NEXT_PUBLIC_SUI_NETWORK=testnet
NEXT_PUBLIC_PACKAGE_ID=<Deployed Poker Package ID>
NEXT_PUBLIC_POKER_CONFIG_ID=<Created PokerConfig Object ID>
NEXT_PUBLIC_STORAGE_UNIT_ID=<Your initialized Storage Unit Object ID>
```

## 3. Support Scripts (`ts-scripts/storage_poker_extension/`)
A suite of TypeScript logic scripts exists to bridge the bare metal deployment into a playable state. These must be executed via `pnpm tsx` to seed the world state before the DApp goes live.

*   `setup-poker-storage.ts`
    *   **Usage:** `pnpm tsx ts-scripts/storage_poker_extension/setup-poker-storage.ts`
    *   **Purpose:** Initializes the "House Bank" by creating a physical EVE Storage Unit and locking preliminary liquidity inside it so that players can actually win payouts against the House. Provides the `STORAGE_UNIT_ID`.
*   `mint-fuel.ts`
    *   **Usage:** `pnpm tsx ts-scripts/storage_poker_extension/mint-fuel.ts`
    *   **Purpose:** An automated batch-minting utility for developers/testers. It natively loops through the 6 accepted official EVE Fuel/Goo resource IDs (e.g. Black Goo, Orange Goo) and mints + deposits quantities of them into the target wallet to allow for infinite local testing of the DApp staking features without mining.
*   `poker-flow.ts`
    *   **Usage:** `pnpm tsx ts-scripts/storage_poker_extension/poker-flow.ts`
    *   **Purpose:** A headless simulator. Executes the full Poker deposit, deal, swap, read, and payout lifecycle entirely in the terminal. Used strictly to validate that the Move smart contract math and vector logic is sound across network boundaries before spending time building the React frontend.

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
