import { Box, Flex, Button } from "@radix-ui/themes";
import { ConnectButton } from "@mysten/dapp-kit-react";
import { PokerTable } from "./PokerTable";
import { useZkLogin } from "./hooks/useZkLogin";

const OAUTH_CLIENT_ID = import.meta.env.VITE_EVE_OAUTH_CLIENT_ID || "00d3ce5b-4cab-4970-a9dc-e122fc1d30ce";

function App() {
  const { isLoggedIn, zkAddress, beginLogin, logout, loadingAuth } = useZkLogin();

  return (
    <Box style={{ background: "#050505", minHeight: "100vh", color: "#e0e0e0", position: "relative" }}>
      <Box style={{ position: "absolute", top: "20px", right: "20px", zIndex: 100 }}>
        {OAUTH_CLIENT_ID ? (
          isLoggedIn ? (
            <Button 
              onClick={logout}
              className="eve-glitch-hover"
              style={{ background: "#111", border: "1px solid var(--color-hostile-red, #ff0000)", color: "var(--color-hostile-red, #ff0000)", cursor: "pointer", fontFamily: "'Space Mono', monospace", borderRadius: "0px", textTransform: "uppercase" }}
            >
              DISCONNECT {zkAddress?.slice(0, 6)}...{zkAddress?.slice(-4)}
            </Button>
          ) : (
            <Button 
              onClick={beginLogin}
              disabled={loadingAuth}
              className="eve-glitch-hover"
              style={{ background: "#111", border: "1px solid var(--color-matrix-green, #00ffcc)", color: "var(--color-matrix-green, #00ffcc)", cursor: "pointer", fontFamily: "'Space Mono', monospace", borderRadius: "0px", textTransform: "uppercase" }} 
            >
              {loadingAuth ? "AUTHENTICATING..." : "EVE FRONTIER LOGIN"}
            </Button>
          )
        ) : (
          <ConnectButton 
            style={{ background: "#111", border: "1px solid var(--color-frontier-orange, #ff6b00)", color: "var(--color-frontier-orange, #ff6b00)", cursor: "pointer", fontFamily: "'Space Mono', monospace", borderRadius: "0px", textTransform: "uppercase" }} 
          />
        )}
      </Box>
      
      <Flex direction="column" align="center" justify="center" style={{ minHeight: "100vh", padding: "20px" }}>
        <PokerTable />
      </Flex>
    </Box>
  );
}

export default App;
