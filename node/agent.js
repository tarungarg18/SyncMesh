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

const coordinatorUrl = "http://localhost:8000";

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sendChange(fileName, operation, hash) {
  const body = { nodeId, fileName, operation };
  if (hash) {
    body.hash = hash;
  }
  fetch(`${coordinatorUrl}/files/change`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((err) => {
    console.log("failed to send change", err.message);
  });
}

fs.watch(storagePath, (eventType, filename) => {
  if (!filename) {
    return;
  }

  const filePath = path.join(storagePath, filename);

  if (eventType === "rename") {
    if (fs.existsSync(filePath)) {
      try {
        const hash = hashFile(filePath);
        console.log(filename, "CREATE", hash);
        sendChange(filename, "CREATE", hash);
      } catch (err) {}
    } else {
      console.log(filename, "DELETE");
      sendChange(filename, "DELETE");
    }
  } else if (eventType === "change") {
    try {
      const hash = hashFile(filePath);
      console.log(filename, "MODIFY", hash);
      sendChange(filename, "MODIFY", hash);
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
