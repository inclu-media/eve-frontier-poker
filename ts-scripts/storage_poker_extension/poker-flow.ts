import "dotenv/config";
import { Transaction } from "@mysten/sui/transactions";
import { MODULES } from "../utils/config";
import { deriveObjectId } from "../utils/derive-object-id";
import { GAME_CHARACTER_ID, STORAGE_A_ITEM_ID, ITEM_A_TYPE_ID } from "../utils/constants";
import {
    getEnvConfig,
    handleError,
    hydrateWorldConfig,
    initializeContext,
    requireEnv,
} from "../utils/helper";
import { getOwnerCap as getStorageUnitOwnerCap } from "../helpers/storage-unit-extension";

async function main() {
    console.log("============= Testing Storage Poker Extension ==============\n");
    try {
        const env = getEnvConfig();
        
        // Contexts
        const adminCtx = initializeContext(env.network, env.adminExportedKey);
        await hydrateWorldConfig(adminCtx);
        
        const playerKey = requireEnv("PLAYER_A_PRIVATE_KEY");
        const playerCtx = initializeContext(env.network, playerKey);
        await hydrateWorldConfig(playerCtx);

        const builderPackageId = requireEnv("BUILDER_SCENE_PACKAGE_ID");
        const extensionConfigId = requireEnv("POKER_EXTENSION_CONFIG_ID");
        const adminCapId = requireEnv("POKER_ADMIN_CAP_ID");

        // ---------------------------------------------------------
        // 1. Configure Poker Rules (Admin Action)
        // ---------------------------------------------------------
        // Testnet Fuel Type IDs provided by the user
        const fuelTypeIds = [77818n, 78437n, 78515n, 78516n, 84868n, 88319n, 88335n];

        console.log("1. Configuring poker rules to accept multiple fuel types as Admin...");
        const adminTx = new Transaction();
        adminTx.moveCall({
            target: `${builderPackageId}::poker::set_poker_config`,
            arguments: [
                adminTx.object(extensionConfigId),
                adminTx.object(adminCapId),
                adminTx.pure.vector("u64", fuelTypeIds),
            ],
        });

        const adminResult = await adminCtx.client.signAndExecuteTransaction({
            transaction: adminTx,
            signer: adminCtx.keypair,
            options: { showEffects: true, showObjectChanges: true },
        });
        console.log("Admin config executed successfully! Digest:", adminResult.digest);


        // ---------------------------------------------------------
        // 2. Authorize Storage Unit (Player Action)
        // ---------------------------------------------------------
        console.log("\n2. Authorizing storage unit as Player...");
        
        const characterId = deriveObjectId(playerCtx.config.objectRegistry, BigInt(GAME_CHARACTER_ID), playerCtx.config.packageId);
        const storageUnitId = deriveObjectId(
            playerCtx.config.objectRegistry,
            BigInt(STORAGE_A_ITEM_ID),
            playerCtx.config.packageId
        );

        const storageUnitOwnerCapId = await getStorageUnitOwnerCap(
            storageUnitId,
            playerCtx.client,
            playerCtx.config,
            playerCtx.address
        );
        if (!storageUnitOwnerCapId) {
            throw new Error(`OwnerCap not found for storage unit ${storageUnitId}`);
        }

        const playerTx = new Transaction();
        const authType = `${builderPackageId}::config::XAuth`;
        
        const [storageUnitOwnerCap, returnReceipt] = playerTx.moveCall({
            target: `${playerCtx.config.packageId}::${MODULES.CHARACTER}::borrow_owner_cap`,
            typeArguments: [`${playerCtx.config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
            arguments: [playerTx.object(characterId), playerTx.object(storageUnitOwnerCapId)],
        });

        playerTx.moveCall({
            target: `${playerCtx.config.packageId}::${MODULES.STORAGE_UNIT}::authorize_extension`,
            typeArguments: [authType],
            arguments: [playerTx.object(storageUnitId), storageUnitOwnerCap],
        });

        playerTx.moveCall({
            target: `${playerCtx.config.packageId}::${MODULES.CHARACTER}::return_owner_cap`,
            typeArguments: [`${playerCtx.config.packageId}::${MODULES.STORAGE_UNIT}::StorageUnit`],
            arguments: [playerTx.object(characterId), storageUnitOwnerCap, returnReceipt],
        });

        const playerResult = await playerCtx.client.signAndExecuteTransaction({
            transaction: playerTx,
            signer: playerCtx.keypair,
            options: { showEffects: true, showObjectChanges: true },
        });

        console.log("Player authorization executed successfully!");
        console.log("Digest:", playerResult.digest);

    } catch (error) {
        handleError(error);
    }
}

main();
