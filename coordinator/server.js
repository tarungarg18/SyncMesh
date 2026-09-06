const express = require("express");
const db = require("./database");

const app = express();
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

function getTargets(sourceNodeId, fileName, latestVersion) {
  const rows = db.prepare("SELECT nodeId, port, lastSeen, status FROM nodes").all();
  const targets = [];
  for (const node of rows) {
    if (node.nodeId === sourceNodeId) continue;
    if (nodeWithStatus(node).status !== "ONLINE") continue;
    const file = getFile(node.nodeId, fileName);
    if (!file || file.deleted || file.version < latestVersion) {
      targets.push(node.nodeId);
    }
  }
  return targets;
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
  res.json(nodeWithStatus(getNode(nodeId)));
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
  res.json(nodeWithStatus(getNode(nodeId)));
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

  const targets = getTargets(nodeId, fileName, version);
  const event = {
    nodeId,
    fileName,
    operation,
    hash: storedHash,
    version,
    updatedAt,
    deleted,
    targets,
  };
  console.log("file change", event);

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

  res.json(event);
});

app.listen(port, () => {
  console.log(`SyncMesh Coordinator is running on http://localhost:${port}`);
});
