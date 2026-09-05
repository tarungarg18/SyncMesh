const express = require("express");

const app = express();
const port = 8000;
const HEARTBEAT_TIMEOUT_MS = 10000;

const nodes = {};

app.use(express.json());

function nodeWithStatus(node) {
  const status =
    Date.now() - node.lastSeen > HEARTBEAT_TIMEOUT_MS ? "OFFLINE" : "ONLINE";
  return { ...node, status };
}

app.get("/", (req, res) => {
  res.send("SyncMesh Coordinator is running");
});

app.post("/nodes/register", (req, res) => {
  const { nodeId, port: nodePort } = req.body;
  nodes[nodeId] = { nodeId, port: nodePort, lastSeen: Date.now() };
  res.json(nodeWithStatus(nodes[nodeId]));
});

app.post("/nodes/heartbeat", (req, res) => {
  const { nodeId } = req.body;
  if (!nodes[nodeId]) {
    return res.json({});
  }
  nodes[nodeId].lastSeen = Date.now();
  res.json(nodeWithStatus(nodes[nodeId]));
});

app.get("/nodes", (req, res) => {
  res.json(Object.values(nodes).map(nodeWithStatus));
});

app.listen(port, () => {
  console.log(`SyncMesh Coordinator is running on http://localhost:${port}`);
});
