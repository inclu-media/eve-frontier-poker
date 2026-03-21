import { Box, Flex, Heading } from "@radix-ui/themes";
import { WalletStatus } from "./WalletStatus";
import { ConnectButton } from "@mysten/dapp-kit-react";
import { PokerTable } from "./PokerTable";

function App() {
  return (
    <Box style={{ padding: "20px", background: "#050505", minHeight: "100vh", color: "#e0e0e0" }}>
      <Flex
        position="sticky"
        px="4"
        py="2"
        direction="row"
        style={{
          display: "flex",
          justifyContent: "space-between",
          borderBottom: "1px solid #00ffcc",
          marginBottom: "30px",
          fontFamily: "'Space Mono', monospace"
        }}
      >
        <Heading size="3" style={{ color: "#00ffcc", letterSpacing: "2px", textTransform: "uppercase" }}>Frontier Poker Extension</Heading>
        
        <Box style={{ display: "flex", alignItems: "center" }}>
          <ConnectButton 
            style={{ background: "#111", border: "1px solid #00ffcc", color: "#00ffcc", cursor: "pointer", fontFamily: "inherit", borderRadius: "0px", textTransform: "uppercase" }} 
          />
        </Box>
      </Flex>
      
      <Flex direction="column" gap="6" align="center">
        <PokerTable />
        
        <Box style={{ opacity: 0.5, scale: "0.8" }}>
          <WalletStatus />
        </Box>
      </Flex>
    </Box>
  );
}

export default App;
