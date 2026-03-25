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
        const fuelTypeIds = [77818n, 78437n, 78515n, 78516n, 84868n, 88319n, 88335n];

        console.log(`Minting 10 units of all ${fuelTypeIds.length} Fuel components directly to your wallet...`);

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
                    txMint.pure.u32(100), // quantity deposited as buffer
                ],
            });
        }

        txMint.moveCall({
            target: `${config.packageId}::${MODULES.CHARACTER}::return_owner_cap`,
            typeArguments: [`${config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
            arguments: [txMint.object(characterId), ownerCapMint, receiptMint],
        });

        console.log("-> Minting Fuel into Storage Unit...");
        await executeSponsoredTransaction(txMint, playerCtx.client, playerCtx.keypair, adminKeypair, playerCtx.address, adminAddress);

        // ==========================
        // TRANSACTION 2: WITHDRAW FUEL
        // ==========================
        const txWithdraw = new Transaction();
        txWithdraw.setSender(playerCtx.address);
        txWithdraw.setGasOwner(adminAddress);

        let [ownerCapWithdraw, receiptWithdraw] = txWithdraw.moveCall({
            target: `${config.packageId}::${MODULES.CHARACTER}::borrow_owner_cap`,
            typeArguments: [`${config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
            arguments: [txWithdraw.object(characterId), txWithdraw.object(storageUnitOwnerCapId)],
        });

        const withdrawnItems = [];
        for (let i = 0; i < fuelTypeIds.length; i++) {
            const withdrawnItem = txWithdraw.moveCall({
                target: `${config.packageId}::${MODULES.STORAGE_UNIT}::withdraw_by_owner`,
                typeArguments: [`${config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
                arguments: [
                    txWithdraw.object(storageUnitId),
                    txWithdraw.object(characterId),
                    ownerCapWithdraw,
                    txWithdraw.pure.u64(fuelTypeIds[i]), // type_id
                    txWithdraw.pure.u32(10), // withdraw quantity
                ],
            });
            withdrawnItems.push(withdrawnItem);
        }

        txWithdraw.moveCall({
            target: `${config.packageId}::${MODULES.CHARACTER}::return_owner_cap`,
            typeArguments: [`${config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
            arguments: [txWithdraw.object(characterId), ownerCapWithdraw, receiptWithdraw],
        });

        txWithdraw.transferObjects(withdrawnItems, playerCtx.address);

        console.log("-> Processing delivery...");
        const result = await executeSponsoredTransaction(
            txWithdraw,
            playerCtx.client,
            playerCtx.keypair,
            adminKeypair,
            playerCtx.address,
            adminAddress
        );

        const createdObjects = result.objectChanges?.filter((o: any) => o.type === "created") || [];
        const itemObjs = createdObjects.filter((o: any) => o.objectType?.includes("::inventory::Item"));

        console.log(`✅ ${itemObjs.length} distinct Fuel items successfully minted and transferred to your wallet!`);
    } catch (e) {
        handleError(e);
    }
}

main();
