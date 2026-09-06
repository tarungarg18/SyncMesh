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
const pulling = new Set();

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

function register() {
  fetch(`${coordinatorUrl}/nodes/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId, port: Number(port) }),
  }).catch((err) => {
    console.log("failed to register", err.message);
  });
}

function heartbeat() {
  fetch(`${coordinatorUrl}/nodes/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId }),
  }).catch((err) => {
    console.log("failed to heartbeat", err.message);
  });
}

fs.watch(storagePath, (eventType, filename) => {
  if (!filename || pulling.has(filename)) {
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
app.use(express.json());

app.get("/status", (req, res) => {
  res.json({ nodeId, port: Number(port), storagePath });
});

app.get("/files/:fileName", (req, res) => {
  const filePath = path.join(storagePath, req.params.fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).end();
  }
  res.sendFile(filePath);
});

app.post("/pull", async (req, res) => {
  const { fileName, sourcePort, hash } = req.body || {};
  if (!fileName || !sourcePort || !hash) {
    return res.status(400).json({ error: "fileName, sourcePort, and hash are required" });
  }

  pulling.add(fileName);
  try {
    const response = await fetch(
      `http://localhost:${sourcePort}/files/${encodeURIComponent(fileName)}`
    );
    if (!response.ok) {
      console.log(fileName, "failure");
      return res.json({ status: "failure" });
    }

    const buf = Buffer.from(await response.arrayBuffer());
    const got = crypto.createHash("sha256").update(buf).digest("hex");
    if (got !== hash) {
      console.log(fileName, "failure");
      return res.json({ status: "failure" });
    }

    fs.writeFileSync(path.join(storagePath, fileName), buf);
    console.log(fileName, "SYNCED");
    res.json({ status: "SYNCED" });
  } catch (err) {
    console.log(fileName, "failure");
    res.json({ status: "failure" });
  } finally {
    setTimeout(() => pulling.delete(fileName), 2000);
  }
});

app.listen(Number(port), () => {
  console.log(`SyncMesh Node ${nodeId} is running on http://localhost:${port}`);
  register();
  setInterval(heartbeat, 3000);
});
