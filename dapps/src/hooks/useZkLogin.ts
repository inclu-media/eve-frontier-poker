import { useState, useEffect } from "react";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
    genAddressSeed,
    generateNonce,
    generateRandomness,
    getExtendedEphemeralPublicKey,
    getZkLoginSignature,
    jwtToAddress,
} from "@mysten/sui/zklogin";
import { useCurrentClient } from "@mysten/dapp-kit-react";
import axios from "axios";
import { jwtDecode, type JwtPayload } from "jwt-decode";

const AUTH_URL = "https://test.auth.evefrontier.com";
// Utopia client ID
const CLIENT_ID = import.meta.env.VITE_EVE_OAUTH_CLIENT_ID || "00d3ce5b-4cab-4970-a9dc-e122fc1d30ce";

const PROVER_URL = import.meta.env.VITE_PROVER_URL || "https://prover-dev.mystenlabs.com/v1";
const ENOKI_API_KEY = import.meta.env.VITE_ENOKI_API_KEY || "";
const IS_TESTNET = import.meta.env.VITE_SUI_RPC_URL?.includes("testnet") || true;

export function useZkLogin() {
    const suiClient = useCurrentClient();
    const [zkAddress, setZkAddress] = useState<string | null>(null);
    const [jwt, setJwt] = useState<string | null>(null);
    const [salt, setSalt] = useState<string>("000000"); // Fixed fallback salt
    const [proof, setProof] = useState<any>(null);
    const [loadingAuth, setLoadingAuth] = useState(false);

    // Run on mount to check if we returned from OAuth
    useEffect(() => {
        const hash = window.location.hash;
        if (hash) {
            const params = new URLSearchParams(hash.replace("#", "?"));
            const token = params.get("id_token");
            if (token) {
                // Clear the hash so the user doesn't see it
                window.history.replaceState(null, "", window.location.pathname);
                completeLogin(token);
            }
        } else {
            // Restore session
            const storedJwt = sessionStorage.getItem("zk_jwt");
            const storedAddress = sessionStorage.getItem("zk_address");
            const storedSalt = sessionStorage.getItem("zk_salt");
            const storedProof = sessionStorage.getItem("zk_proof");
            
            if (storedJwt && storedAddress && storedProof && storedSalt) {
                setJwt(storedJwt);
                setZkAddress(storedAddress);
                setSalt(storedSalt);
                setProof(JSON.parse(storedProof));
            }
        }
    }, []);

    const getEpoch = async () => {
        try {
            // @ts-ignore - Some versions of the Sui SDK might not expose this method directly on the dapp-kit Client
            if (typeof suiClient.getLatestSuiSystemState === "function") {
                const state = await suiClient.getLatestSuiSystemState();
                return Number(state.epoch) + 5;
            }
            throw new Error("SDK method missing");
        } catch (e) {
            const rpcUrl = import.meta.env.VITE_SUI_RPC_URL || "https://fullnode.testnet.sui.io:443";
            const res = await axios.post(rpcUrl, {
                jsonrpc: "2.0",
                id: 1,
                method: "suix_getLatestSuiSystemState",
                params: []
            });
            return Number(res.data.result.epoch) + 5;
        }
    };

    const beginLogin = async () => {
        setLoadingAuth(true);
        try {
            const ephemeralKeyPair = new Ed25519Keypair();
            const randomness = generateRandomness();
            const maxEpoch = await getEpoch();
            
            const nonce = generateNonce(ephemeralKeyPair.getPublicKey(), maxEpoch, randomness);
            
            // Store ephemeral data in sessionStorage to retrieve after redirect
            sessionStorage.setItem("zk_ephemeral", ephemeralKeyPair.getSecretKey());
            sessionStorage.setItem("zk_maxEpoch", maxEpoch.toString());
            sessionStorage.setItem("zk_randomness", randomness);

            const redirectURL = encodeURIComponent(window.location.origin);
            const loginUrl = `${AUTH_URL}/oauth2/authorize?client_id=${CLIENT_ID}&response_type=id_token&scope=openid&redirect_uri=${redirectURL}&nonce=${nonce}`;
            
            window.location.href = loginUrl;
        } catch (e) {
            console.error("Failed to start login", e);
            setLoadingAuth(false);
        }
    };

    const completeLogin = async (token: string) => {
        setLoadingAuth(true);
        try {
            const privKeyRaw = sessionStorage.getItem("zk_ephemeral");
            const maxEpoch = Number(sessionStorage.getItem("zk_maxEpoch"));
            const randomness = sessionStorage.getItem("zk_randomness");

            if (!privKeyRaw || !maxEpoch || !randomness) throw new Error("Missing ephemeral session data");
            
            const ephemeralKeyPair = Ed25519Keypair.fromSecretKey(privKeyRaw);
            const extendedEphemeralPublicKey = getExtendedEphemeralPublicKey(ephemeralKeyPair.getPublicKey());
            
            let userSalt = "000000"; // fallback
            let finalProof = null;

            if (IS_TESTNET && ENOKI_API_KEY) {
                // Using Enoki for testnet
                const enokiRes = await axios.post(
                    "https://api.enoki.mystenlabs.com/v1/zklogin/proof",
                    {
                        network: "testnet",
                        jwt: token,
                        extendedEphemeralPublicKey,
                        maxEpoch,
                        jwtRandomness: randomness,
                        keyClaimName: "sub"
                    },
                    { headers: { Authorization: `Bearer ${ENOKI_API_KEY}` } }
                );
                finalProof = enokiRes.data.proof;
                userSalt = enokiRes.data.salt;
            } else {
                // Devnet fallback prover
                const res = await axios.post(
                    PROVER_URL,
                    {
                        jwt: token,
                        extendedEphemeralPublicKey,
                        maxEpoch,
                        jwtRandomness: randomness,
                        salt: userSalt,
                        keyClaimName: "sub",
                    }
                );
                finalProof = res.data;
            }

            const address = jwtToAddress(token, userSalt, false);
            
            sessionStorage.setItem("zk_jwt", token);
            sessionStorage.setItem("zk_address", address);
            sessionStorage.setItem("zk_salt", userSalt);
            sessionStorage.setItem("zk_proof", JSON.stringify(finalProof));
            
            setJwt(token);
            setZkAddress(address);
            setSalt(userSalt);
            setProof(finalProof);

        } catch (e) {
            console.error("Failed to complete zkLogin", e);
        }
        setLoadingAuth(false);
    };

    const logout = () => {
        sessionStorage.removeItem("zk_jwt");
        sessionStorage.removeItem("zk_address");
        sessionStorage.removeItem("zk_salt");
        sessionStorage.removeItem("zk_proof");
        sessionStorage.removeItem("zk_ephemeral");
        sessionStorage.removeItem("zk_maxEpoch");
        sessionStorage.removeItem("zk_randomness");
        setJwt(null);
        setZkAddress(null);
        setProof(null);
    };

    const signAndExecuteZkTx = async (txBytes: Uint8Array) => {
        if (!jwt || !proof || !salt) throw new Error("Not logged in");

        const privKeyRaw = sessionStorage.getItem("zk_ephemeral");
        const maxEpoch = Number(sessionStorage.getItem("zk_maxEpoch"));
        if (!privKeyRaw || !maxEpoch) throw new Error("Session expired");

        const ephemeralKeyPair = Ed25519Keypair.fromSecretKey(privKeyRaw);
        
        // Sign the transaction bytes with ephemeral key
        const signedBytes = await ephemeralKeyPair.signTransaction(txBytes);

        // Derive address seed
        const decodedJwt = jwtDecode(jwt) as JwtPayload;
        const addressSeed = genAddressSeed(BigInt(salt), "sub", decodedJwt.sub as string, decodedJwt.aud as string).toString();

        // Assemble ZK signature
        const zkLoginSignature = getZkLoginSignature({
            inputs: {
                ...proof,
                addressSeed,
            },
            maxEpoch,
            userSignature: signedBytes.signature,
        });

        // Execute natively
        return await suiClient.core.executeTransaction({
            transaction: new Uint8Array(Buffer.from(signedBytes.bytes, "base64")),
            signatures: [zkLoginSignature],
        });
    };

    return {
        isLoggedIn: !!zkAddress,
        zkAddress,
        loadingAuth,
        beginLogin,
        logout,
        signAndExecuteZkTx
    };
}
