import "dotenv/config";
import { Transaction } from "@mysten/sui/transactions";
import { getEnvConfig, hydrateWorldConfig, initializeContext, requireEnv, handleError } from "../utils/helper";
import { deriveObjectId } from "../utils/derive-object-id";
import { GAME_CHARACTER_ID, STORAGE_A_ITEM_ID } from "../utils/constants";
import { getOwnerCap as getStorageUnitOwnerCap } from "../helpers/storage-unit-extension";

async function main() {
    console.log("============= SWEEPING STORAGE UNIT CLEAN ==============\n");
    try {
        const env = getEnvConfig();
        const playerKey = requireEnv("PLAYER_A_PRIVATE_KEY");
        const ctx = initializeContext(env.network, playerKey);
        await hydrateWorldConfig(ctx);

        const config = ctx.config;
        const storageUnitId = deriveObjectId(config.objectRegistry, BigInt(STORAGE_A_ITEM_ID), config.packageId);
        const characterId = deriveObjectId(config.objectRegistry, BigInt(GAME_CHARACTER_ID), config.packageId);

        console.log(`Connecting to Storage Unit: ${storageUnitId}...`);

        const storageUnitOwnerCapId = await getStorageUnitOwnerCap(
            storageUnitId,
            ctx.client,
            config,
            ctx.address
        );

        if (!storageUnitOwnerCapId) {
            throw new Error(`OwnerCap not found for storage unit. Cannot wipe storage.`);
        }

        let itemsToSweep = [];
        console.log("Scanning the specific Player's inventory partition...");
        try {
            const dynResponse = await ctx.client.getDynamicFieldObject({ 
                parentId: storageUnitId, 
                name: { type: "0x2::object::ID", value: storageUnitOwnerCapId } 
            });
            let invData = (dynResponse?.data?.content as any)?.fields?.value;
            if (invData?.fields) invData = invData.fields;

            const itemsArray = invData?.items || [];
            let contents: any[] = [];
            if (Array.isArray(itemsArray)) contents = itemsArray;
            else if (itemsArray.fields && itemsArray.fields.contents) contents = itemsArray.fields.contents;
            else if (itemsArray.contents) contents = itemsArray.contents;

            for (const item of contents) {
                const typeId = item.key?.toString() || item.fields?.key?.toString();
                const val = item.value || item.fields?.value;
                const qty = Number(val?.quantity || val?.fields?.quantity || 0);
                if (typeId && qty > 0) {
                    itemsToSweep.push({ typeId, qty });
                }
            }
        } catch (e) {
            console.log("Player partition not found or unreadable. It is already empty.");
        }

        if (itemsToSweep.length === 0) {
             console.log("Storage Unit is already completely empty! No stakes to wipe.");
             return;
        }

        console.log(`Found ${itemsToSweep.length} residual fuel stacks. Sweeping to void wallet...`);

        const tx = new Transaction();
        const MODULES = { CHARACTER: "character", STORAGE_UNIT: "storage_unit" };

        let [ownerCap, receipt] = tx.moveCall({
            target: `${config.packageId}::${MODULES.CHARACTER}::borrow_owner_cap`,
            typeArguments: [`${config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
            arguments: [tx.object(characterId), tx.object(storageUnitOwnerCapId)],
        });

        // Consolidate identical types so we only withdraw exactly the aggregated value!
        let consolidatedTotals: Record<string, number> = {};
        for(const item of itemsToSweep) {
            consolidatedTotals[item.typeId] = (consolidatedTotals[item.typeId] || 0) + item.qty;
        }

        console.log("Total swept values to extract:", consolidatedTotals);

        // Loop over the total quantities and withdraw them!
        let totalWithdrawnObjects = [];
        for (const [typeId, qty] of Object.entries(consolidatedTotals)) {
            const withdrawnItem = tx.moveCall({
                target: `${config.packageId}::${MODULES.STORAGE_UNIT}::withdraw_by_owner`,
                typeArguments: [`${config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
                arguments: [
                    tx.object(storageUnitId),
                    tx.object(characterId),
                    ownerCap,
                    tx.pure.u64(typeId),
                    tx.pure.u32(qty),
                ],
            });
            totalWithdrawnObjects.push(withdrawnItem);
        }

        tx.moveCall({
            target: `${config.packageId}::${MODULES.CHARACTER}::return_owner_cap`,
            typeArguments: [`${config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
            arguments: [tx.object(characterId), ownerCap, receipt],
        });

        // Toss the fuel into the void 
        tx.transferObjects(totalWithdrawnObjects, "0x0000000000000000000000000000000000000000000000000000000000000000");

        const sweepResult = await ctx.client.signAndExecuteTransaction({
             transaction: tx,
             signer: ctx.keypair,
             options: { showEffects: true }
        });

        console.log("✅ WIPE COMPLETE! Storage unit restored to absolute zero liquidity.");
        console.log("Digest:", sweepResult.digest);

    } catch (e) {
        handleError(e);
    }
}

main();
