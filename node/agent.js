const express = require("express");
const fs = require("fs");

const [nodeId, port, storagePath] = process.argv.slice(2);

if (!nodeId || !port || !storagePath) {
  console.log("Usage: node agent.js <nodeId> <port> <storagePath>");
  process.exit(1);
}

fs.mkdirSync(storagePath, { recursive: true });

const app = express();

app.get("/status", (req, res) => {
  res.json({ nodeId, port: Number(port), storagePath });
});

app.listen(Number(port), () => {
  console.log(`SyncMesh Node ${nodeId} is running on http://localhost:${port}`);
});
