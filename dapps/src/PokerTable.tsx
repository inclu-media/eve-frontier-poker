import { useState, useEffect } from "react";
import { Box, Button, Heading, Text, Flex } from "@radix-ui/themes";
import { GearIcon } from "@radix-ui/react-icons";
import { useCurrentAccount, useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { useSmartObject } from "@evefrontier/dapp-kit";
import { useZkLogin } from "./hooks/useZkLogin";

const SUITS = ["♠", "♥", "♦", "♣"];
const VALUES = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

const FUEL_NAMES: Record<string, string> = {
  "78437": "Unstable Fuel",
  "78515": "D1 Fuel",
  "78516": "D2 Fuel",
  "84868": "SOF-40 Fuel",
  "88319": "EU-40 Fuel",
  "88335": "EU-90 Fuel"
};

function getCardParts(cardVal: number) {
  const value = VALUES[cardVal % 13];
  const suit = SUITS[Math.floor(cardVal / 13)];
  return { value, suit };
}

export function PokerTable() {
  const walletAccount = useCurrentAccount();
  const { signAndExecuteTransaction } = useDAppKit();
  const { zkAddress, isLoggedIn: isZkLoggedIn, signAndExecuteZkTx } = useZkLogin();
  const suiClient = useCurrentClient();
  
  const activeAddress = isZkLoggedIn ? zkAddress : walletAccount?.address;
  const isLoggedIn = isZkLoggedIn || !!walletAccount;
  
  const [gameSession, setGameSession] = useState<any>(null);
  const [heldCards, setHeldCards] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Waiting for next hand...");
  const [maxStake, setMaxStake] = useState<number | null>(null);
  const [availableFuels, setAvailableFuels] = useState<any[]>([]);
  const [selectedFuelId, setSelectedFuelId] = useState<string>("");
  const [finalGameResult, setFinalGameResult] = useState<any>(null);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dynamicCharId, setDynamicCharId] = useState<string | null>(null);
  
  const [adminOpen, setAdminOpen] = useState(false);
  const [houseFuelsList, setHouseFuelsList] = useState<any[]>([]);
  const [regularFuelsList, setRegularFuelsList] = useState<any[]>([]);

  const targetFuelRecord = availableFuels.find(f => f.id === selectedFuelId);
  const currentTargetTypeId = targetFuelRecord ? targetFuelRecord.typeId?.toString() : "78437";
  const fuelName = FUEL_NAMES[currentTargetTypeId] || "Unknown Fuel";

  const smartObject = useSmartObject() as any;
  const assembly = smartObject.assembly;
  const charInfo = smartObject.character || smartObject.assemblyOwner;

  const getHandName = (multiplier: number) => {
    switch (Number(multiplier)) {
      case 800: return "Royal Flush";
      case 50: return "Straight Flush";
      case 25: return "Four of a Kind";
      case 9: return "Full House";
      case 6: return "Flush";
      case 4: return "Straight";
      case 3: return "Three of a Kind";
      case 2: return "Two Pair";
      case 1: return "Jacks or Better";
      default: return "Loss";
    }
  };

  const pkgId = import.meta.env.VITE_BUILDER_SCENE_PACKAGE_ID || "0x123";
  const configId = import.meta.env.VITE_POKER_EXTENSION_CONFIG_ID || "0x123";
  
  // URL parameters as fundamental foolproof fallback
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new Map();
  const getParam = (k: string) => urlParams.get(k) || null;

  // Use context variables if available, otherwise securely fallback to URL params, then .env for explicit testing overrides
  const isEnvFallback = !assembly?.id && !getParam("smartObjectId") && !getParam("itemId");
  const extractedStorageId = assembly?.id || getParam("itemId") || getParam("smartObjectId") || getParam("storageUnitId") || getParam("objectId");
  const storageUnitId = extractedStorageId || import.meta.env.VITE_STORAGE_UNIT_ID || "0x123";
  const extractedCharId = charInfo?.characterId?.toString() || charInfo?.id || getParam("characterId") || getParam("playerId");
  const characterId = extractedCharId || dynamicCharId || import.meta.env.VITE_CHARACTER_ID || "0x123";
  const rpcUrl = import.meta.env.VITE_SUI_RPC_URL || "https://fullnode.testnet.sui.io:443";


  useEffect(() => {
    if (!activeAddress) return;
    refreshSession();
  }, [activeAddress]);

  useEffect(() => {
    async function fetchDynamicChar() {
      if (!isLoggedIn || !activeAddress) return;
      try {
        const charRes = await fetch(rpcUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `query GetWalletChars($owner: SuiAddress!) { address(address: $owner) { objects(last: 1, filter: { type: "0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75::character::PlayerProfile" }) { nodes { contents { extract(path: "character_id") { asAddress { asObject { asMoveObject { contents { json } } } } } } } } } }`,
            variables: { owner: activeAddress }
          })
        }).then(r => r.json());
        const node = charRes?.data?.address?.objects?.nodes?.[0];
        const extractedCharIdFromJson = node?.contents?.extract?.asAddress?.asObject?.asMoveObject?.contents?.json?.id;
        if (extractedCharIdFromJson) setDynamicCharId(extractedCharIdFromJson);
      } catch (e) { console.error(e); }
    }
    fetchDynamicChar();
  }, [activeAddress, isLoggedIn]);

  useEffect(() => {
    async function fetchStorageData() {
      if (!storageUnitId || storageUnitId === "0x123") {
          setMaxStake(0);
          setAvailableFuels([]);
          return;
      }
      try {
        const suPromise = fetch(rpcUrl, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sui_getObject", params: [storageUnitId, { showContent: true }] })
        }).then(r => r.json());
        
        const [suResponse] = await Promise.all([suPromise]);
        
        // Import lightweight hash on the fly since we are inside a React component
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
        const openInvKey = "0x" + Array.from(digest).map((b: any) => b.toString(16).padStart(2, '0')).join('');

        const invKeys = suResponse?.result?.data?.content?.fields?.inventory_keys || [];
        let allFuels: Record<string, number> = {}; 
        let houseFuels: Record<string, number> = {};
        
        for (const iterInvKey of invKeys) {
            const dynResponse = await fetch(rpcUrl, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "suix_getDynamicFieldObject", params: [storageUnitId, { type: "0x2::object::ID", value: iterInvKey }] })
            }).then(r => r.json());
            
            let invData = dynResponse?.result?.data?.content?.fields?.value;
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
                  
                  if (iterInvKey === openInvKey) {
                      houseFuels[typeId] = (houseFuels[typeId] || 0) + qty;
                  } else {
                      allFuels[typeId] = (allFuels[typeId] || 0) + qty;
                  }
               }
            }
        }
        
        const regularList = Object.keys(allFuels).map(typeId => ({
            id: typeId,
            typeId: typeId,
            quantity: allFuels[typeId].toString()
        }));
        
        const houseList = Object.keys(houseFuels).map(typeId => ({
            id: typeId,
            typeId: typeId,
            quantity: houseFuels[typeId].toString()
        }));
        
        setRegularFuelsList(regularList);
        setHouseFuelsList(houseList);
        setAvailableFuels(regularList);
        
        const currentSelected = selectedFuelId || (regularList.length > 0 ? regularList[0].id : "");
        if (!selectedFuelId && regularList.length > 0) setSelectedFuelId(currentSelected);
        
        if (currentSelected && houseFuels[currentSelected]) {
            setMaxStake(Math.floor(houseFuels[currentSelected] / 800));
        } else {
            setMaxStake(0);
        }
        
      } catch (err: any) {
        console.log(`CATCH_ERR: ${err.message}`);
        setMaxStake(0); 
        setAvailableFuels([]);
      }
    }
    
    fetchStorageData();
    const interval = setInterval(fetchStorageData, 5000);
    return () => clearInterval(interval);
  }, [storageUnitId, selectedFuelId, refreshTrigger]);

  const refreshSession = async () => {
    if (!activeAddress) return;
    try {
      // Get all GameSession objects owned by the player
      const result = await suiClient.core.listOwnedObjects({
        owner: activeAddress,
        type: `${pkgId}::poker::GameSession`,
        include: { json: true },
      });
      const data = result?.objects || [];
      if (data.length > 0) {
        // Just take the first one for simplicity
        const sessionObj = data[0];
        if (sessionObj && sessionObj.json) {
          setGameSession({
            data: {
              objectId: sessionObj.objectId,
              content: sessionObj.json,
            }
          });
          setMessage("Choose cards to HOLD.");
        }
      } else {
        setGameSession(null);
        setHeldCards([]);
        setMessage("No active game. Deal to start.");
      }
    } catch (e) {
      console.error(e);
      setMessage("Error fetching session.");
    }
  };

  const dealCards = async () => {
    if (!isLoggedIn) return;
    if (!selectedFuelId) {
      setMessage("ERROR: Please select a fuel item to stake!");
      return;
    }
    
    setLoading(true);
    setMessage("Dealing...");
    setFinalGameResult(null);

    try {
      const targetFuelRecord = availableFuels.find((f: any) => f.id === selectedFuelId);
      const stakeQty = targetFuelRecord ? Number(targetFuelRecord.quantity) : 1;
      
      let actualStake = stakeQty;
      if (maxStake !== null && actualStake > maxStake) {
          actualStake = maxStake;
      }

      const txb = new Transaction();
      
      txb.moveCall({
        target: `${pkgId}::poker::deposit_and_deal`,
        arguments: [
          txb.object(configId),
          txb.object(storageUnitId),
          txb.object(characterId),
          txb.pure.u64(selectedFuelId),
          txb.pure.u32(actualStake), // Dynamically stake up to house limit
          txb.object("0x8"), // Random
        ]
      });

      if (isZkLoggedIn) {
        txb.setSender(activeAddress!);
        const txBytes = await txb.build({ client: suiClient });
        await signAndExecuteZkTx(txBytes);
      } else {
        await signAndExecuteTransaction({ transaction: txb });
      }

      console.log("Dealt cards");
      refreshSession();
      setLoading(false);
    } catch (e) {
      console.error(e);
      setMessage("Deal failed. Check console.");
      setLoading(false);
    }
  };

  const throwCards = async () => {
    if (!isLoggedIn || !gameSession) return;
    if (pkgId.length < 60) {
      setMessage("ERROR: Please configure your .env variables first!");
      return;
    }

    setLoading(true);
    setMessage("Throwing cards...");

    try {
      const txb = new Transaction();
      
      txb.moveCall({
        target: `${pkgId}::poker::draw_and_resolve`,
        arguments: [
          txb.object(configId),
          txb.object(gameSession.data.objectId),
          txb.object(storageUnitId),
          txb.object(characterId),
          txb.pure.vector("u8", heldCards),
          txb.object("0x8"), // Random
        ]
      });

      let digest;
      if (isZkLoggedIn) {
        txb.setSender(activeAddress!);
        const txBytes = await txb.build({ client: suiClient });
        const result: any = await signAndExecuteZkTx(txBytes);
        digest = result.digest || result.effects?.transactionDigest || result.Transaction?.digest;
      } else {
        const result: any = await signAndExecuteTransaction({ transaction: txb });
        digest = result.digest || result.effects?.transactionDigest || result.Transaction?.digest;
      }
      
      if (!digest) {
          setMessage("No digest found! Check console.");
          setLoading(false);
          return;
      }

      // Query standard sui RPC for events directly to bypass missing SDK wrapper methods
      const rpcResponse = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "sui_getTransactionBlock",
              params: [digest, { showEvents: true }]
          })
      }).then(r => r.json());
      
      const txDetails = rpcResponse.result;
      
      console.log("Threw cards", txDetails);
      
      const resolvedEvent = txDetails.events?.find((e: any) => e.type.includes("::poker::HandResolved"));
      if (resolvedEvent) {
          setFinalGameResult(resolvedEvent.parsedJson);
          setGameSession(null);
          setMessage("Hand resolved!");
      } else {
          setMessage("Hand resolved! Check terminal for payout info.");
          refreshSession();
      }
      
      setLoading(false);
    } catch (error) {
      console.error(error);
      setMessage("Draw failed. Check console.");
      setLoading(false);
    }
  };

  const toggleHold = (index: number) => {
    setHeldCards((prev: number[]) => 
      prev.includes(index) ? prev.filter((i: number) => i !== index) : [...prev, index]
    );
  };

  const getCardsArray = () => {
    if (!gameSession) return [];
    const src = gameSession.data?.content?.cards || gameSession.data?.content?.fields?.cards;
    
    if (Array.isArray(src)) return src;
    
    if (typeof src === "string") {
      try {
        // If it was comma separated
        if (src.includes(",")) return src.split(",").map(Number);
        
        // base64 decode vector<u8> which is Sui's default encoding for binary
        const binaryString = atob(src);
        const bytes = [];
        for (let i = 0; i < binaryString.length; i++) {
            bytes.push(binaryString.charCodeAt(i));
        }
        return bytes;
      } catch (e) {
        console.error("Could not parse cards string", e);
        return [];
      }
    }
    return [];
  };

  return (
    <Box className="eve-terminal poker-container eve-panel" p="6" style={{
      fontFamily: "'Space Mono', monospace",
      maxWidth: "500px",
      margin: "0 auto",
      boxShadow: "0 0 15px var(--color-orange-glow)",
      position: "relative"
    }}>
      {/* ADMIN OVERLAY MASK */}
      {adminOpen && (
        <Box style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(10, 10, 15, 0.95)", zIndex: 100, border: "1px solid var(--color-frontier-orange)", padding: "20px", overflowY: "auto", backdropFilter: "blur(4px)" }}>
           <Flex justify="between" align="center" mb="4" style={{ borderBottom: "1px solid var(--color-gunmetal)", paddingBottom: "10px" }}>
              <Heading size="5" style={{ color: "var(--color-frontier-orange)", textTransform: "uppercase", letterSpacing: "2px" }}>Storage Admin</Heading>
              <Button onClick={() => setAdminOpen(false)} style={{ background: "none", color: "var(--color-text-muted)", cursor: "pointer", border: "1px solid var(--color-gunmetal)", borderRadius: "0px", fontFamily: "'Space Mono', monospace" }}>[X] CLOSE</Button>
           </Flex>
           
           <Box mb="5">
               <Heading size="3" style={{ color: "var(--color-matrix-green)", marginBottom: "10px", letterSpacing: "1px", textTransform: "uppercase" }}>House Open Storage</Heading>
               {houseFuelsList.length > 0 ? houseFuelsList.map(f => (
                   <Flex key={f.id} justify="between" style={{ borderBottom: "1px dashed var(--color-gunmetal)", padding: "8px 0" }}>
                       <Text style={{ fontFamily: "'Space Mono', monospace", color: "#ccc" }}>{FUEL_NAMES[f.typeId] || "Unknown"}</Text>
                       <Text style={{ fontFamily: "'Space Mono', monospace", color: "var(--color-matrix-green)", fontWeight: "bold" }}>{f.quantity}</Text>
                   </Flex>
               )) : <Text style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>No liquidity trapped in house.</Text>}
           </Box>
           
           <Box mb="5">
               <Heading size="3" style={{ color: "var(--color-frontier-orange)", marginBottom: "10px", letterSpacing: "1px", textTransform: "uppercase" }}>Player Regular Storage</Heading>
               {regularFuelsList.length > 0 ? regularFuelsList.map(f => (
                   <Flex key={f.id} justify="between" align="center" style={{ borderBottom: "1px dashed var(--color-gunmetal)", padding: "8px 0" }}>
                       <Text style={{ fontFamily: "'Space Mono', monospace", color: "#ccc" }}>{FUEL_NAMES[f.typeId] || "Unknown"}</Text>
                       <Flex align="center" gap="3">
                           <Text style={{ fontFamily: "'Space Mono', monospace", color: "var(--color-frontier-orange)", fontWeight: "bold" }}>{f.quantity}</Text>
                           <Button 
                             onClick={async () => {
                                 const txb = new Transaction();
                                 txb.moveCall({
                                     target: `${pkgId}::poker::user_fund_house`,
                                     arguments: [
                                         txb.object(configId),
                                         txb.object(storageUnitId),
                                         txb.object(characterId),
                                         txb.pure.u64(f.typeId),
                                         txb.pure.u32(f.quantity)
                                     ]
                                 });
                                 if (isZkLoggedIn) {
                                     txb.setSender(activeAddress!);
                                     const txBytes = await txb.build({ client: suiClient });
                                     await signAndExecuteZkTx(txBytes);
                                 } else {
                                     await signAndExecuteTransaction({ transaction: txb });
                                 }
                                 setRefreshTrigger(prev => prev + 1);
                             }}
                             style={{ background: "var(--color-gunmetal)", padding: "2px 8px", cursor: "pointer", fontSize: "10px" }}
                           >FUND HOUSE</Button>
                       </Flex>
                   </Flex>
               )) : <Text style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>No available fuel stakes.</Text>}
           </Box>
        </Box>
      )}

      <Box 
        mb="4" 
        style={{ 
          backgroundImage: "url('/backdrop.png')", 
          backgroundSize: "cover", 
          backgroundPosition: "center", 
          aspectRatio: "3/1",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "0 30px",
          border: "1px solid var(--color-gunmetal)",
          position: "relative",
          overflow: "hidden"
        }}
      >
        <Box style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)" }} />
        <Heading size="6" style={{ letterSpacing: "4px", textTransform: "uppercase", color: "var(--color-frontier-orange)", position: "relative", zIndex: 1 }}>BURN :: RATE</Heading>
        <Text size="2" style={{ letterSpacing: "2px", textTransform: "uppercase", color: "var(--color-text-muted)", position: "relative", zIndex: 1, display: "block", marginTop: "4px" }}>Fuel Poker</Text>
        
        {isLoggedIn && activeAddress && (
             <Button 
               onClick={() => setAdminOpen(true)}
               variant="ghost"
               style={{ position: "absolute", top: "12px", right: "20px", color: "var(--color-frontier-orange)", cursor: "pointer", zIndex: 10, padding: 0 }}
             >
               <GearIcon width="24" height="24" />
             </Button>
        )}

        <Box style={{ position: "absolute", bottom: "12px", right: "20px", textAlign: "right", zIndex: 1 }}>
          {smartObject.loading ? (
            <Text className="eve-flicker" size="1" style={{ color: "var(--color-matrix-green)", fontFamily: "'Space Mono', monospace", display: "block", marginBottom: "4px" }}>
              SYNCING WITH GRAPHQL...
            </Text>
          ) : (
            <Text className="eve-flicker" size="1" style={{ color: isEnvFallback ? "var(--color-hostile-red)" : "var(--color-frontier-orange)", fontFamily: "'Space Mono', monospace", display: "block", marginBottom: "4px" }}>
              SYS {">"} ASS: {storageUnitId.substring(0,6)}...{storageUnitId.substring(storageUnitId.length-4)} | CHR: {(characterId || "none").substring(0,6)}...
            </Text>
          )}
          {maxStake !== null && (
            <Text 
              className="eve-flicker"
              size="2" 
              style={{ color: "var(--color-frontier-orange)", fontFamily: "'Space Mono', monospace", display: "block", marginBottom: "4px" }}
            >
              {fuelName}: <b style={{ color: "var(--color-frontier-orange)" }}>{maxStake} MAX</b>
            </Text>
          )}
          <Text 
            className="eve-flicker"
            size="1" 
            style={{ color: "var(--color-frontier-orange)", fontFamily: "'Space Mono', monospace", display: "block" }}
          >
            SYS {">"} {message.toUpperCase()}
          </Text>
        </Box>
      </Box>

      <Box style={{ minHeight: "220px", display: "flex", flexDirection: "column", justifyContent: "space-between", marginBottom: "20px" }}>
        
        {/* TOP: Result Section (Always 32px or empty) */}
        <Box style={{ minHeight: "42px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          {finalGameResult && (
            <Text size="3" style={{ color: "var(--color-text-muted)" }}>
              Result: <b style={{ color: "var(--color-frontier-orange)" }}>{getHandName(Number(finalGameResult.multiplier))}</b>
            </Text>
          )}
        </Box>

        {/* MIDDLE: Cards Section (Always 120px) */}
        <Box style={{ position: "relative", minHeight: "120px", display: "flex", flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: "8px" }}>
          
          {/* WINNER OVERLAY */}
          {finalGameResult && (
            <Heading 
              size="8" 
              style={{ 
                position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 30,
                color: Number(finalGameResult.multiplier) > 0 ? "var(--color-matrix-green)" : "var(--color-hostile-red)",
                textShadow: "0 0 20px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.8)",
                pointerEvents: "none",
                fontStyle: "italic",
                letterSpacing: "4px"
              }}
            >
              {Number(finalGameResult.multiplier) > 0 ? "WINNER!" : "GAME OVER"}
            </Heading>
          )}

          {/* Render Cards */}
          {finalGameResult ? (
            [...finalGameResult.final_cards].sort((a, b) => (a % 13) - (b % 13) || Math.floor(a / 13) - Math.floor(b / 13)).map((cardVal: number, i: number) => (
              <Box key={i} className="eve-card" style={{ border: "1px solid var(--color-gunmetal)", backgroundColor: "var(--color-background)", backgroundImage: cardVal >= 13 && cardVal <= 38 ? "linear-gradient(rgba(0,0,0,0.65), rgba(0,0,0,0.65)), url('/red-bg.png')" : "linear-gradient(rgba(0,0,0,0.65), rgba(0,0,0,0.65)), url('/black-bg.png')", backgroundSize: "cover", backgroundPosition: "center", width: "80px", aspectRatio: "5/7", position: "relative", borderRadius: "6px" }}>
                <div style={{ position: "absolute", top: "8px", left: "8px", textAlign: "left", lineHeight: "1", zIndex: 20 }}>
                  <Text size="4" style={{ color: cardVal >= 13 && cardVal <= 38 ? "var(--color-hostile-red)" : "var(--color-text-muted)", fontWeight: "bold", display: "block" }}>{getCardParts(cardVal).value}</Text>
                  <Text size="5" style={{ color: cardVal >= 13 && cardVal <= 38 ? "var(--color-hostile-red)" : "var(--color-text-muted)", display: "block" }}>{getCardParts(cardVal).suit}</Text>
                </div>
              </Box>
            ))
          ) : gameSession ? (
            getCardsArray().map((cardVal: number, i: number) => ({ cardVal, originalIndex: i }))
              .sort((a, b) => (a.cardVal % 13) - (b.cardVal % 13) || Math.floor(a.cardVal / 13) - Math.floor(b.cardVal / 13))
              .map(({ cardVal, originalIndex }) => (
              <Box key={originalIndex} className="eve-card eve-glitch-hover" onClick={() => toggleHold(originalIndex)} style={{ border: `1px solid ${heldCards.includes(originalIndex) ? "var(--color-frontier-orange)" : "var(--color-gunmetal)"}`, cursor: "pointer", backgroundColor: heldCards.includes(originalIndex) ? "var(--color-charcoal)" : "var(--color-background)", backgroundImage: cardVal >= 13 && cardVal <= 38 ? (heldCards.includes(originalIndex) ? "linear-gradient(rgba(0,0,0,0.8), rgba(0,0,0,0.8)), url('/red-bg.png')" : "linear-gradient(rgba(0,0,0,0.65), rgba(0,0,0,0.65)), url('/red-bg.png')") : (heldCards.includes(originalIndex) ? "linear-gradient(rgba(0,0,0,0.8), rgba(0,0,0,0.8)), url('/black-bg.png')" : "linear-gradient(rgba(0,0,0,0.65), rgba(0,0,0,0.65)), url('/black-bg.png')"), backgroundSize: "cover", backgroundPosition: "center", transition: "all 0.2s", width: "80px", aspectRatio: "5/7", position: "relative", borderRadius: "6px", transform: heldCards.includes(originalIndex) ? "scale(0.95)" : "scale(1)", boxShadow: heldCards.includes(originalIndex) ? "inset 0 0 15px var(--color-orange-glow)" : "none" }}>
                <div style={{ position: "absolute", top: "8px", left: "8px", textAlign: "left", lineHeight: "1", zIndex: 20 }}>
                  <Text size="4" style={{ color: cardVal >= 13 && cardVal <= 38 ? "var(--color-hostile-red)" : "var(--color-text-muted)", fontWeight: "bold", display: "block" }}>{getCardParts(cardVal).value}</Text>
                  <Text size="5" style={{ color: cardVal >= 13 && cardVal <= 38 ? "var(--color-hostile-red)" : "var(--color-text-muted)", display: "block" }}>{getCardParts(cardVal).suit}</Text>
                </div>
              </Box>
            ))
          ) : null}
        </Box>

        {/* BOTTOM: Payout or Dropdown (Depends on state, but ALWAYS identical height) */}
        <Box style={{ minHeight: "42px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {finalGameResult ? (
            <Text size="4" style={{ display: "block", color: Number(finalGameResult.multiplier) > 0 ? "var(--color-matrix-green)" : "var(--color-text-muted)", textAlign: "center" }}>
              Payout: <b>+{finalGameResult.payout_amount} Fuel</b>
            </Text>
          ) : !gameSession ? (
            <Box>
              <Text size="2" color="gray" mb="2" style={{ display: "block", textAlign: "left" }}>Select Stake (Storage Unit Available Fuels):</Text>
              {availableFuels.length > 0 ? (
                <Box style={{ position: "relative", width: "100%", zIndex: 50 }}>
                  <Box 
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    style={{ padding: "10px", background: "var(--color-background)", color: "var(--color-frontier-orange)", border: "1px solid var(--color-gunmetal)", cursor: "pointer", display: "flex", justifyContent: "space-between", fontFamily: "'Space Mono', monospace" }}
                  >
                    <Text>{availableFuels.find(f => f.id === selectedFuelId) ? `${FUEL_NAMES[availableFuels.find(f => f.id === selectedFuelId)!.typeId] || "Unknown"} - ${availableFuels.find(f => f.id === selectedFuelId)!.quantity} Local Units` : "Select Fuel"}</Text>
                    <Text>▼</Text>
                  </Box>
                  {isDropdownOpen && (
                    <Box style={{ position: "absolute", bottom: "100%", left: 0, right: 0, background: "var(--color-background)", border: "1px solid var(--color-frontier-orange)", zIndex: 100, maxHeight: "150px", overflowY: "auto", boxShadow: "0 -2px 10px rgba(0,0,0,0.8)" }}>
                      {availableFuels.map(f => (
                        <Box 
                          key={f.id}
                          onClick={() => { setSelectedFuelId(f.id); setIsDropdownOpen(false); }}
                          style={{ padding: "10px", cursor: "pointer", color: "var(--color-frontier-orange)", borderBottom: "1px solid var(--color-gunmetal)", fontFamily: "'Space Mono', monospace" }}
                          className="eve-glitch-hover"
                        >
                          {FUEL_NAMES[f.typeId] || "Unknown"} - {f.quantity} Local Units
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>
              ) : (<Text size="2" color="red" style={{ textAlign: "left" }}>No valid Fuel items found in the Storage Unit.</Text>)}
            </Box>
          ) : null}
        </Box>
      </Box>

      {/* BUTTONS (Anchored safely outside the fixed layout structure) */}
      <Box>
        {finalGameResult ? (
          <Button className="eve-glitch-hover" onClick={() => { setFinalGameResult(null); setMessage("Waiting for next hand..."); setHeldCards([]); setRefreshTrigger(prev => prev + 1); }} style={{ width: "100%", background: "var(--color-button-background)", border: "1px solid var(--color-frontier-orange)", color: "var(--color-frontier-orange)", cursor: "pointer", fontWeight: "bold" }}>PLAY AGAIN</Button>
        ) : gameSession ? (
          <Button className="eve-glitch-hover" disabled={loading} onClick={throwCards} style={{ width: "100%", background: "var(--color-frontier-orange)", border: "1px solid var(--color-frontier-orange)", color: "#000", cursor: "pointer", fontWeight: "bold" }}>{loading ? "PROCESSING..." : "DRAW & RESOLVE"}</Button>
        ) : (
          <Button className="eve-glitch-hover" disabled={loading || !isLoggedIn || !selectedFuelId || maxStake === 0} onClick={dealCards} style={{ width: "100%", background: "var(--color-button-background)", border: `1px solid ${maxStake === 0 ? "var(--color-hostile-red)" : "var(--color-frontier-orange)"}`, color: maxStake === 0 ? "var(--color-hostile-red)" : "var(--color-frontier-orange)", cursor: maxStake === 0 ? "not-allowed" : "pointer", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "1px" }}>{loading ? "INITIALIZING..." : !isLoggedIn ? "CONNECT WALLET" : (maxStake === 0 ? "HOUSE FUNDS DEPLETED" : "DEAL STAKE")}</Button>
        )}
      </Box>
    </Box>
  );
}
