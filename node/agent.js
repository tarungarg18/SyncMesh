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
const lastHash = {};
const dirty = {};

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
  return fetch(`${coordinatorUrl}/nodes/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId, port: Number(port) }),
  })
    .then((res) => res.json())
    .then(() => recover())
    .catch((err) => {
      console.log("failed to register", err.message);
    });
}

function heartbeat() {
  fetch(`${coordinatorUrl}/nodes/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (!data.nodeId) {
        register();
      }
    })
    .catch((err) => {
      console.log("failed to heartbeat", err.message);
    });
}

async function pullFile(fileName, sourcePort, hash) {
  pulling.add(fileName);
  try {
    const dest = path.join(storagePath, fileName);
    if (fs.existsSync(dest)) {
      const localHash = hashFile(dest);
      if (localHash === hash) {
        lastHash[fileName] = hash;
        dirty[fileName] = false;
        return "SYNCED";
      }
      if (dirty[fileName]) {
        console.log(fileName, "CONFLICT");
        return "CONFLICT";
      }
    }

    const response = await fetch(
      `http://localhost:${sourcePort}/files/${encodeURIComponent(fileName)}`
    );
    if (!response.ok) {
      console.log(fileName, "failure");
      return "failure";
    }

    const buf = Buffer.from(await response.arrayBuffer());
    const got = crypto.createHash("sha256").update(buf).digest("hex");
    if (got !== hash) {
      console.log(fileName, "failure");
      return "failure";
    }

    lastHash[fileName] = got;
    dirty[fileName] = false;
    fs.writeFileSync(dest, buf);
    console.log(fileName, "SYNCED");
    return "SYNCED";
  } catch (err) {
    console.log(fileName, "failure");
    return "failure";
  } finally {
    setTimeout(() => pulling.delete(fileName), 2000);
  }
}

async function recover() {
  try {
    const nodesRes = await fetch(`${coordinatorUrl}/nodes`);
    const filesRes = await fetch(`${coordinatorUrl}/files`);
    if (!nodesRes.ok || !filesRes.ok) {
      return;
    }
    const nodes = await nodesRes.json();
    const files = await filesRes.json();
    const byId = {};
    for (const node of nodes) {
      byId[node.nodeId] = node;
    }
    const latest = {};
    for (const file of files) {
      if (file.deleted || file.nodeId === nodeId) {
        continue;
      }
      const name = file.filePath;
      if (!latest[name] || file.version > latest[name].version) {
        latest[name] = file;
      }
    }
    for (const name of Object.keys(latest)) {
      const file = latest[name];
      const local = path.join(storagePath, name);
      if (fs.existsSync(local) && hashFile(local) === file.hash) {
        lastHash[name] = file.hash;
        continue;
      }
      const source = byId[file.nodeId];
      if (!source || source.status !== "ONLINE") {
        continue;
      }
      await pullFile(name, source.port, file.hash);
    }
  } catch (err) {
    console.log("failed to recover", err.message);
  }
}

fs.watch(storagePath, (eventType, filename) => {
  if (!filename) {
    return;
  }
  filename = String(filename);
  if (pulling.has(filename) || filename.startsWith(".")) {
    return;
  }

  const filePath = path.join(storagePath, filename);

  if (eventType === "rename") {
    if (fs.existsSync(filePath)) {
      try {
        const hash = hashFile(filePath);
        if (lastHash[filename] === hash) {
          return;
        }
        lastHash[filename] = hash;
        dirty[filename] = true;
        console.log(filename, "CREATE", hash);
        sendChange(filename, "CREATE", hash);
      } catch (err) {}
    } else {
      delete lastHash[filename];
      delete dirty[filename];
      console.log(filename, "DELETE");
      sendChange(filename, "DELETE");
    }
  } else if (eventType === "change") {
    try {
      const hash = hashFile(filePath);
      if (lastHash[filename] === hash) {
        return;
      }
      lastHash[filename] = hash;
      dirty[filename] = true;
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
  res.sendFile(path.resolve(filePath));
});

app.post("/pull", async (req, res) => {
  const { fileName, sourcePort, hash, operation } = req.body || {};
  if (operation === "DELETE") {
    if (!fileName) {
      return res.status(400).json({ error: "fileName is required" });
    }
    pulling.add(fileName);
    try {
      const dest = path.join(storagePath, fileName);
      if (fs.existsSync(dest)) {
        fs.unlinkSync(dest);
      }
      delete lastHash[fileName];
      delete dirty[fileName];
      console.log(fileName, "SYNCED");
      res.json({ status: "SYNCED" });
    } finally {
      setTimeout(() => pulling.delete(fileName), 2000);
    }
    return;
  }

  if (!fileName || !sourcePort || !hash) {
    return res.status(400).json({ error: "fileName, sourcePort, and hash are required" });
  }

  const status = await pullFile(fileName, sourcePort, hash);
  res.json({ status });
});

app.listen(Number(port), () => {
  console.log(`SyncMesh Node ${nodeId} is running on http://localhost:${port}`);
  register();
  setInterval(heartbeat, 3000);
});
