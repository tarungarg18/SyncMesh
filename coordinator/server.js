const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const db = require("./database");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const port = 8000;
const HEARTBEAT_TIMEOUT_MS = 10000;

app.use(express.json());

function nodeWithStatus(node) {
  const status =
    Date.now() - node.lastSeen > HEARTBEAT_TIMEOUT_MS ? "OFFLINE" : "ONLINE";
  return { ...node, status };
}

function getNode(nodeId) {
  return db.prepare("SELECT nodeId, port, lastSeen, status FROM nodes WHERE nodeId = ?").get(nodeId);
}

function getFile(nodeId, filePath) {
  return db.prepare(
    "SELECT filePath, hash, version, nodeId, updatedAt, deleted FROM files WHERE nodeId = ? AND filePath = ?"
  ).get(nodeId, filePath);
}

app.get("/", (req, res) => {
  res.send("SyncMesh Coordinator is running");
});

app.post("/nodes/register", (req, res) => {
  const { nodeId, port: nodePort } = req.body;
  const lastSeen = Date.now();
  db.prepare(`
    INSERT INTO nodes (nodeId, port, lastSeen, status)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(nodeId) DO UPDATE SET
      port = excluded.port,
      lastSeen = excluded.lastSeen,
      status = excluded.status
  `).run(nodeId, nodePort, lastSeen, "ONLINE");
  const node = nodeWithStatus(getNode(nodeId));
  io.emit("NODE_STATUS_CHANGED", node);
  res.json(node);
});

app.post("/nodes/heartbeat", (req, res) => {
  const { nodeId } = req.body;
  const existing = getNode(nodeId);
  if (!existing) {
    return res.json({});
  }
  db.prepare("UPDATE nodes SET lastSeen = ?, status = ? WHERE nodeId = ?").run(
    Date.now(),
    "ONLINE",
    nodeId
  );
  const node = nodeWithStatus(getNode(nodeId));
  io.emit("NODE_STATUS_CHANGED", node);
  res.json(node);
});

app.get("/nodes", (req, res) => {
  const rows = db.prepare("SELECT nodeId, port, lastSeen, status FROM nodes").all();
  res.json(rows.map(nodeWithStatus));
});

app.post("/files/change", (req, res) => {
  const { nodeId, fileName, operation, hash } = req.body || {};
  if (!nodeId || !fileName || !operation) {
    return res.status(400).json({ error: "nodeId, fileName, and operation are required" });
  }

  const existing = getFile(nodeId, fileName);
  const updatedAt = Date.now();
  const deleted = operation === "DELETE" ? 1 : 0;
  let version;
  if (!existing) {
    version = 1;
  } else if (operation === "DELETE") {
    version = existing.version;
  } else {
    version = existing.version + 1;
  }
  const storedHash = hash || (existing && existing.hash) || null;

  db.prepare(`
    INSERT INTO files (filePath, hash, version, nodeId, updatedAt, deleted)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(nodeId, filePath) DO UPDATE SET
      hash = excluded.hash,
      version = excluded.version,
      updatedAt = excluded.updatedAt,
      deleted = excluded.deleted
  `).run(fileName, storedHash, version, nodeId, updatedAt, deleted);

  const event = {
    nodeId,
    fileName,
    operation,
    hash: storedHash,
    version,
    updatedAt,
    deleted,
  };
  console.log("file change", event);
  io.emit("FILE_CHANGED", event);
<<<<<<< HEAD
=======

  if (!deleted && storedHash) {
    const source = getNode(nodeId);
    if (source) {
      for (const targetId of targets) {
        const target = getNode(targetId);
        if (!target) continue;
        fetch(`http://localhost:${target.port}/pull`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName,
            sourcePort: source.port,
            hash: storedHash,
            version,
          }),
        }).catch((err) => {
          console.log("failed to notify", targetId, err.message);
        });
      }
    }
  }

>>>>>>> cebc37f81b2aa49edff213203e7d79f7f8b9b1df
  res.json(event);
});

setInterval(() => {
  const rows = db.prepare("SELECT nodeId, port, lastSeen, status FROM nodes").all();
  for (const node of rows) {
    const withStatus = nodeWithStatus(node);
    if (withStatus.status !== node.status) {
      db.prepare("UPDATE nodes SET status = ? WHERE nodeId = ?").run(withStatus.status, node.nodeId);
      io.emit("NODE_STATUS_CHANGED", withStatus);
    }
  }
}, 2000);

server.listen(port, () => {
  console.log(`SyncMesh Coordinator is running on http://localhost:${port}`);
});
