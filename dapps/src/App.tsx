import { Box, Flex } from "@radix-ui/themes";
import { PokerTable } from "./PokerTable";

function App() {
  return (
    <Box style={{ background: "#050505", minHeight: "100%", height: "100%", color: "#e0e0e0", position: "relative", display: "flex", flexDirection: "column" }}>
      <Flex direction="column" align="center" justify="center" style={{ flex: 1, width: "100%", padding: 0 }}>
        <PokerTable />
      </Flex>
    </Box>
  );
}

export default App;
