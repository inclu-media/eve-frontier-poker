import "dotenv/config";
import { Transaction } from "@mysten/sui/transactions";
import { getEnvConfig, hydrateWorldConfig, initializeContext, requireEnv, handleError } from "../utils/helper";
import { deriveObjectId } from "../utils/derive-object-id";
import { GAME_CHARACTER_ID, STORAGE_A_ITEM_ID } from "../utils/constants";
import { keypairFromPrivateKey } from "../../docker/world-contracts/ts-scripts/utils/client";

async function main() {
    console.log("============= SWEEPING HOUSE FUNDS CLEAN ==============\n");
    try {
        const env = getEnvConfig();
        const playerKey = requireEnv("PLAYER_A_PRIVATE_KEY");
        const playerCtx = initializeContext(env.network, playerKey);
        await hydrateWorldConfig(playerCtx);

        // We use adminCtx to actually defund the house because we protected defund_house with AdminCap
        const adminKeypair = keypairFromPrivateKey(env.adminExportedKey);
        const adminAddress = adminKeypair.getPublicKey().toSuiAddress();
        
        const config = playerCtx.config;
        const builderPackageId = requireEnv("BUILDER_SCENE_PACKAGE_ID");
        const adminCapId = requireEnv("POKER_ADMIN_CAP_ID");

        const characterId = deriveObjectId(config.objectRegistry, BigInt(GAME_CHARACTER_ID), config.packageId);
        const storageUnitId = deriveObjectId(config.objectRegistry, BigInt(STORAGE_A_ITEM_ID), config.packageId);

        console.log(`Connecting to Storage Unit: ${storageUnitId}...`);

        // Dynamically locate the exact open inventory hash
        const blake2b = (await import('@noble/hashes/blake2b')).blake2b;
        const idBytes = new Uint8Array(32);
        const hex = storageUnitId.replace('0x', '');
        for (let i = 0; i < 32; i++) {
            idBytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        }
        const strBytes = new TextEncoder().encode("open_inventory");
        const combinedBytes = new Uint8Array(idBytes.length + strBytes.length);
        combinedBytes.set(idBytes, 0);
        combinedBytes.set(strBytes, idBytes.length);
        const digest = blake2b(combinedBytes, { dkLen: 32 });
        const openInvKey = "0x" + Array.from(digest).map(b => b.toString(16).padStart(2, '0')).join('');

        // Find which inventory IDs match the structural map
        const dfResponse = await playerCtx.client.getDynamicFields({ parentId: storageUnitId });
        const allDynamicFields = dfResponse.data || [];
        const openObjectIds = allDynamicFields
            .filter(df => df.name.type === "0x2::object::ID" && df.name.value === openInvKey)
            .map(df => df.objectId);

        let itemsToSweep = [];
        console.log("Scanning House Open Inventory for trapped liquidity...");
        for (const objId of openObjectIds) {
            try {
                const dynResponse = await playerCtx.client.getObject({ id: objId, options: { showContent: true } });
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
            } catch (e) {}
        }

        if (itemsToSweep.length === 0) {
            console.log("✅ The House Open Inventory is ALREADY completely empty! No action needed.");
            return;
        }

        console.log(`Found ${itemsToSweep.length} exact fuel structures inside the House. Withdrawing entirely to Admin Wallet...`);

        const txFund = new Transaction();
        txFund.setSender(adminAddress);
        txFund.setGasOwner(adminAddress);

        // Dynamically withdraw ONLY exactly what exists inside the House
        for (const fuelObj of itemsToSweep) {
            txFund.moveCall({
                target: `${builderPackageId}::poker::defund_house`,
                arguments: [
                    txFund.object(adminCapId),
                    txFund.object(storageUnitId),
                    txFund.object(characterId),
                    txFund.pure.u64(fuelObj.typeId),
                    txFund.pure.u32(fuelObj.qty),
                ],
            });
        }

        const fundResult = await playerCtx.client.signAndExecuteTransaction({
             transaction: txFund,
             signer: adminKeypair,
             options: { showEffects: true, showObjectChanges: true }
        });

        console.log("✅ Poker House Successfully Swept!");
        console.log("Digest:", fundResult.digest);

    } catch (e) {
        handleError(e);
    }
}

main();
