import "dotenv/config";
import { Transaction } from "@mysten/sui/transactions";
import {
    getEnvConfig,
    handleError,
    hydrateWorldConfig,
    initializeContext,
    requireEnv,
} from "../utils/helper";

async function main() {
    console.log("============= Configuring Poker Rules ==============\n");
    try {
        const env = getEnvConfig();
        
        // Admin Context
        const adminCtx = initializeContext(env.network, env.adminExportedKey);

        const builderPackageId = requireEnv("BUILDER_SCENE_PACKAGE_ID");
        const extensionConfigId = requireEnv("POKER_EXTENSION_CONFIG_ID");
        const adminCapId = requireEnv("POKER_ADMIN_CAP_ID");

        // Testnet Fuel Type IDs configured for Poker
        const fuelTypeIds = [77818n, 78437n, 78515n, 78516n];

        console.log("-> Adding Multiple Fuel Types to the Poker Config Whitelist...");
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
        
        console.log("✅ Admin config executed successfully!");
        console.log("Digest:", adminResult.digest);

    } catch (error) {
        handleError(error);
    }
}

main();
