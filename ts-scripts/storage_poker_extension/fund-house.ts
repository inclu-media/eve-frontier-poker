import "dotenv/config";
import { Transaction } from "@mysten/sui/transactions";
import {
    getEnvConfig,
    hydrateWorldConfig,
    initializeContext,
    requireEnv,
    handleError
} from "../utils/helper";
import { executeSponsoredTransaction } from "../../docker/world-contracts/ts-scripts/utils/transaction";
import { deriveObjectId } from "../utils/derive-object-id";
import { GAME_CHARACTER_ID, STORAGE_A_ITEM_ID } from "../utils/constants";
import { getOwnerCap as getStorageUnitOwnerCap } from "../helpers/storage-unit-extension";
import { keypairFromPrivateKey } from "../../docker/world-contracts/ts-scripts/utils/client";

async function main() {
    try {
        const env = getEnvConfig();
        const playerKey = requireEnv("PLAYER_A_PRIVATE_KEY");
        // We use playerCtx to borrow their storage unit for minting tools
        const playerCtx = initializeContext(env.network, playerKey);
        await hydrateWorldConfig(playerCtx);

        // We use adminCtx to actually fund the house because we protected fund_house with AdminCap
        const adminKeypair = keypairFromPrivateKey(env.adminExportedKey);
        const adminAddress = adminKeypair.getPublicKey().toSuiAddress();
        
        const config = playerCtx.config;
        const builderPackageId = requireEnv("BUILDER_SCENE_PACKAGE_ID");
        const adminCapId = requireEnv("POKER_ADMIN_CAP_ID");

        const MODULES = { CHARACTER: "character", STORAGE_UNIT: "storage_unit" };

        const characterId = deriveObjectId(config.objectRegistry, BigInt(GAME_CHARACTER_ID), config.packageId);
        const storageUnitId = deriveObjectId(config.objectRegistry, BigInt(STORAGE_A_ITEM_ID), config.packageId);

        const storageUnitOwnerCapId = await getStorageUnitOwnerCap(
            storageUnitId,
            playerCtx.client,
            config,
            playerCtx.address
        );

        if (!storageUnitOwnerCapId) {
            throw new Error(`OwnerCap not found for storage unit ${storageUnitId}`);
        }

        console.log("-> Minting 100,000 units of All 6 Fuel types to use as House Liquidity...");

        // ==========================
        // TRANSACTION 1: MINT FUEL
        // ==========================
        const txMint = new Transaction();
        txMint.setSender(playerCtx.address);
        txMint.setGasOwner(adminAddress);

        let [ownerCapMint, receiptMint] = txMint.moveCall({
            target: `${config.packageId}::${MODULES.CHARACTER}::borrow_owner_cap`,
            typeArguments: [`${config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
            arguments: [txMint.object(characterId), txMint.object(storageUnitOwnerCapId)],
        });

        // Testnet Fuel Type IDs configured for Poker
        const fuelTypeIds = [78437n, 78515n, 78516n, 84868n, 88319n, 88335n];
        let withdrawnItems = [];

        for (let i = 0; i < fuelTypeIds.length; i++) {
            txMint.moveCall({
                target: `${config.packageId}::${MODULES.STORAGE_UNIT}::game_item_to_chain_inventory`,
                typeArguments: [`${config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
                arguments: [
                    txMint.object(storageUnitId),
                    txMint.object(config.adminAcl),
                    txMint.object(characterId),
                    ownerCapMint,
                    txMint.pure.u64(BigInt(Date.now() + i)), // random unique item ID for the stack
                    txMint.pure.u64(fuelTypeIds[i]), // type_id (fuel)
                    txMint.pure.u64(10n), // volume
                    txMint.pure.u32(100000), // EXACTLY the amount needed for the house
                ],
            });

            const withdrawnItem = txMint.moveCall({
                target: `${config.packageId}::${MODULES.STORAGE_UNIT}::withdraw_by_owner`,
                typeArguments: [`${config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
                arguments: [
                    txMint.object(storageUnitId),
                    txMint.object(characterId),
                    ownerCapMint,
                    txMint.pure.u64(fuelTypeIds[i]), // type_id
                    txMint.pure.u32(100000), // withdraw 100,000 for the house
                ],
            });
            withdrawnItems.push(withdrawnItem);
        }

        txMint.moveCall({
            target: `${config.packageId}::${MODULES.CHARACTER}::return_owner_cap`,
            typeArguments: [`${config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
            arguments: [txMint.object(characterId), ownerCapMint, receiptMint],
        });

        // TRICK: We transfer the withdrawn items to the ADMIN ADDRESS so the admin can call fund_house
        txMint.transferObjects(withdrawnItems, adminAddress);

        let mintResult;
        try {
             mintResult = await executeSponsoredTransaction(txMint, playerCtx.client, playerCtx.keypair, adminKeypair, playerCtx.address, adminAddress);
        } catch(e) {
             console.error("Minting failed", e);
             return;
        }

        const createdObjects = mintResult.objectChanges?.filter((o: any) => o.type === "created") || [];
        const itemObjs = createdObjects.filter((o: any) => o.objectType?.includes("::inventory::Item"));

        if (itemObjs.length === 0) throw new Error("Could not find the minted Item objects transferred to Admin!");

        console.log(`✅ ${itemObjs.length} Liquidity Items Minted successfully.`);

        console.log("-> Waiting for Sui blockchain indexer to synchronize newly minted items...");
        await new Promise(r => setTimeout(r, 2000));

        // ==========================
        // TRANSACTION 2: FUND HOUSE
        // ==========================
        console.log("-> Depositing Liquidity into the Poker House Open Storage...");
        const txFund = new Transaction();
        // This transaction must be sent by the Admin to use the AdminCap
        txFund.setSender(adminAddress);
        txFund.setGasOwner(adminAddress);

        for (const itemObj of itemObjs) {
            txFund.moveCall({
                target: `${builderPackageId}::poker::fund_house`,
                arguments: [
                    txFund.object(adminCapId),
                    txFund.object(storageUnitId),
                    txFund.object(characterId),
                    txFund.object((itemObj as any).objectId),
                ],
            });
        }

        const fundResult = await playerCtx.client.signAndExecuteTransaction({
             transaction: txFund,
             signer: adminKeypair,
             options: { showEffects: true, showObjectChanges: true }
        });

        console.log("✅ Poker House Funded Successfully!");
        console.log("Digest:", fundResult.digest);

    } catch (e) {
        handleError(e);
    }
}

main();
