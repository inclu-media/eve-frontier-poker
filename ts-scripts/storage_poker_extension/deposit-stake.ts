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
        const playerCtx = initializeContext(env.network, playerKey);
        await hydrateWorldConfig(playerCtx);

        const adminKeypair = keypairFromPrivateKey(env.adminExportedKey);
        const adminAddress = adminKeypair.getPublicKey().toSuiAddress();
        const config = playerCtx.config;
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

        // Testnet Fuel Type IDs configured for Poker
        const fuelTypeIds = [77818n, 78437n, 78515n, 78516n];

        console.log(`Depositing 10 units of all ${fuelTypeIds.length} Fuel components directly to the Storage Unit as stakes...`);

        // ==========================
        // DEPOSIT STAKES INTO STORAGE UNIT
        // ==========================
        const txMint = new Transaction();
        txMint.setSender(playerCtx.address);
        txMint.setGasOwner(adminAddress);

        let [ownerCapMint, receiptMint] = txMint.moveCall({
            target: `${config.packageId}::${MODULES.CHARACTER}::borrow_owner_cap`,
            typeArguments: [`${config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
            arguments: [txMint.object(characterId), txMint.object(storageUnitOwnerCapId)],
        });

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
                    txMint.pure.u32(100), // quantity deposited
                ],
            });
        }

        txMint.moveCall({
            target: `${config.packageId}::${MODULES.CHARACTER}::return_owner_cap`,
            typeArguments: [`${config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
            arguments: [txMint.object(characterId), ownerCapMint, receiptMint],
        });

        console.log("-> Processing deposit transaction...");
        const result = await executeSponsoredTransaction(txMint, playerCtx.client, playerCtx.keypair, adminKeypair, playerCtx.address, adminAddress);

        console.log(`✅ Fuel stakes successfully deposited into the Storage Unit!`);
    } catch (e) {
        handleError(e);
    }
}

main();
