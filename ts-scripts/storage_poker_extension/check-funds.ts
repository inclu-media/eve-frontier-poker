import "dotenv/config";
import { getEnvConfig, hydrateWorldConfig, initializeContext, requireEnv, handleError } from "../utils/helper";
import { deriveObjectId } from "../utils/derive-object-id";
import { GAME_CHARACTER_ID, STORAGE_A_ITEM_ID } from "../utils/constants";

const FUEL_NAMES: Record<string, string> = {
  "78437": "Unstable Fuel",
  "78515": "D1 Fuel",
  "78516": "D2 Fuel",
  "84868": "SOF-40 Fuel",
  "88319": "EU-40 Fuel",
  "88335": "EU-90 Fuel"
};

async function getInventoryBalances(client: any, objectIds: string[]) {
    let allFuels: Record<string, number> = {}; 

    for (const objId of objectIds) {
        try {
            const dynResponse = await client.getObject({
                id: objId,
                options: { showContent: true }
            });
            
            let invData = dynResponse?.data?.content?.fields?.value;
            if (invData?.fields) invData = invData.fields; 
            
            const itemsArray = invData?.items || [];
            let contents: any[] = [];
            if (Array.isArray(itemsArray)) contents = itemsArray;
            else if (itemsArray.fields && itemsArray.fields.contents) contents = itemsArray.fields.contents;
            else if (itemsArray.contents) contents = itemsArray.contents;
            
            for (const item of contents) {
               const typeId = item.key?.toString() || item.fields?.key?.toString();
               if (typeId && FUEL_NAMES[typeId]) {
                  const val = item.value || item.fields?.value;
                  const qty = Number(val?.quantity || val?.fields?.quantity || 0);
                  allFuels[typeId] = (allFuels[typeId] || 0) + qty;
               }
            }
        } catch (e: any) {
            console.warn(`[ERROR] Could not read inventory partition ${objId}: ${e.message}`);
        }
    }
    return allFuels;
}

import { blake2b } from '@noble/hashes/blake2b';

function getOpenInventoryKey(storageUnitId: string): string {
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
    return "0x" + Array.from(digest).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function main() {
    console.log("============= Querying Poker Storage Unit Funds ==============\n");
    try {
        const env = getEnvConfig();
        const playerKey = requireEnv("PLAYER_A_PRIVATE_KEY");
        const ctx = initializeContext(env.network, playerKey);
        await hydrateWorldConfig(ctx);

        const config = ctx.config;
        const storageUnitId = deriveObjectId(config.objectRegistry, BigInt(STORAGE_A_ITEM_ID), config.packageId);

        console.log(`Connecting to Storage Unit: ${storageUnitId}...\n`);

        const suObject = await ctx.client.getObject({ id: storageUnitId, options: { showContent: true } });
        if (!suObject.data || !suObject.data.content || suObject.data.content.dataType !== "moveObject") {
            throw new Error("Could not fetch storage unit data!");
        }

        const fields = suObject.data.content.fields as any;
        const allKeys: string[] = fields.inventory_keys || [];
        
        const openInvKey = getOpenInventoryKey(storageUnitId);
        
        // Find which inventory IDs match the structural map
        const dfResponse = await ctx.client.getDynamicFields({ parentId: storageUnitId });
        const allDynamicFields = dfResponse.data || [];
        
        // Match the deterministically computed open inventory key
        const openObjectIds = allDynamicFields
            .filter(df => df.name.type === "0x2::object::ID" && df.name.value === openInvKey)
            .map(df => df.objectId);
            
        // Filter out the open inventory from the remaining player inventories
        const regularObjectIds = allDynamicFields
            .filter(df => df.name.type === "0x2::object::ID" && allKeys.includes(df.name.value as string) && df.name.value !== openInvKey)
            .map(df => df.objectId);

        // Fetch House Funds (Open Inventory)
        console.log("------------------------------------------");
        console.log("HOUSE FUNDS  (Open Inventory for Payouts)");
        console.log("------------------------------------------");
        const houseBalances = await getInventoryBalances(ctx.client, openObjectIds);
        if (Object.keys(houseBalances).length === 0) {
            console.log("   [Empty] No fuel liquidity found.");
        } else {
            for (const [typeId, qty] of Object.entries(houseBalances)) {
                console.log(`   🔸 ${FUEL_NAMES[typeId].padEnd(15)}: ${qty.toLocaleString()} units`);
            }
        }
        console.log("\n");

        // Fetch Player Stakes (Regular Inventory)
        console.log("------------------------------------------");
        console.log("PLAYER STAKES (Regular Inventory for Dropdown)");
        console.log("------------------------------------------");
        const stakeBalances = await getInventoryBalances(ctx.client, regularObjectIds);
        if (Object.keys(stakeBalances).length === 0) {
            console.log("   [Empty] No player stakes deposited yet.");
        } else {
            for (const [typeId, qty] of Object.entries(stakeBalances)) {
                console.log(`   🔹 ${FUEL_NAMES[typeId].padEnd(15)}: ${qty.toLocaleString()} units`);
            }
        }
        console.log("\n==============================================================");

    } catch (e) {
        handleError(e);
    }
}

main();
