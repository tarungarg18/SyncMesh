const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const db = require("./database");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const port = 8000;
const HEARTBEAT_TIMEOUT_MS = 10000;
const activity = [];

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

function logActivity(item) {
  activity.unshift(item);
}

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

function getTargets(sourceNodeId, fileName, latestVersion, forDelete) {
  const rows = db.prepare("SELECT nodeId, port, lastSeen, status FROM nodes").all();
  const targets = [];
  for (const node of rows) {
    if (node.nodeId === sourceNodeId) continue;
    if (nodeWithStatus(node).status !== "ONLINE") continue;
    if (forDelete) {
      targets.push(node.nodeId);
      continue;
    }
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

app.get("/files", (req, res) => {
  const rows = db.prepare(
    "SELECT filePath, hash, version, nodeId, updatedAt, deleted FROM files"
  ).all();
  res.json(rows);
});

app.get("/activity", (req, res) => {
  res.json(activity);
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

  const targets = deleted
    ? getTargets(nodeId, fileName, version, true)
    : getTargets(nodeId, fileName, version, false);
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
  io.emit("FILE_CHANGED", event);
  logActivity({ time: updatedAt, fileName, operation, nodeId });

  const source = getNode(nodeId);
  if (source) {
    for (const targetId of targets) {
      const target = getNode(targetId);
      if (!target) continue;
      const body = deleted
        ? { fileName, operation: "DELETE" }
        : {
            fileName,
            sourcePort: source.port,
            hash: storedHash,
            version,
          };
      if (deleted || storedHash) {
        fetch(`http://localhost:${target.port}/pull`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
          .then((res) => res.json())
          .then((result) => {
            if (result.status === "SYNCED") {
              db.prepare(`
                INSERT INTO files (filePath, hash, version, nodeId, updatedAt, deleted)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(nodeId, filePath) DO UPDATE SET
                  hash = excluded.hash,
                  version = excluded.version,
                  updatedAt = excluded.updatedAt,
                  deleted = excluded.deleted
              `).run(fileName, storedHash, version, targetId, Date.now(), deleted);
              io.emit("FILE_SYNCED", { nodeId: targetId, fileName, hash: storedHash, version });
              logActivity({
                time: Date.now(),
                fileName,
                operation: "SYNCED",
                nodeId: targetId,
              });
            } else if (result.status === "CONFLICT") {
              io.emit("FILE_SYNCED", { nodeId: targetId, fileName, status: "CONFLICT" });
              logActivity({
                time: Date.now(),
                fileName,
                operation: "CONFLICT",
                nodeId: targetId,
              });
            }
          })
          .catch((err) => {
            console.log("failed to notify", targetId, err.message);
          });
      }
    }
  }

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
