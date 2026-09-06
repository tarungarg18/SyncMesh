const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const path = require("path");

const nodeId = process.argv[2];
const port = process.argv[3];
const storagePath = path.resolve(
  process.argv[4] || path.join(__dirname, "..", "storage", nodeId)
);

if (!nodeId || !port) {
  console.log("Usage: node agent.js <nodeId> <port> [storagePath]");
  process.exit(1);
}

fs.mkdirSync(storagePath, { recursive: true });

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

fs.watch(storagePath, (eventType, filename) => {
  if (!filename) {
    return;
  }

  const filePath = path.join(storagePath, filename);

  if (eventType === "rename") {
    if (fs.existsSync(filePath)) {
      try {
        console.log(filename, "CREATE", hashFile(filePath));
      } catch (err) {}
    } else {
      console.log(filename, "DELETE");
    }
  } else if (eventType === "change") {
    try {
      console.log(filename, "MODIFY", hashFile(filePath));
    } catch (err) {}
  }
});

const app = express();

app.get("/status", (req, res) => {
  res.json({ nodeId, port: Number(port), storagePath });
});

app.listen(Number(port), () => {
  console.log(`SyncMesh Node ${nodeId} is running on http://localhost:${port}`);
});
