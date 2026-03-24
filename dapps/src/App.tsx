import { Box, Flex } from "@radix-ui/themes";
import { PokerTable } from "./PokerTable";

function App() {
  return (
    <Box style={{ background: "#050505", minHeight: "100vh", color: "#e0e0e0", position: "relative" }}>
      <Flex direction="column" align="center" justify="center" style={{ minHeight: "100vh", width: "100%", padding: 0 }}>
        <PokerTable />
      </Flex>
    </Box>
  );
}

export default App;
