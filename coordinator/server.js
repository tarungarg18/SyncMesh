const express = require("express");

const app = express();
const port = 8000;

const nodes = {};

app.use(express.json());

app.get("/", (req, res) => {
  res.send("SyncMesh Coordinator is running");
});

app.post("/nodes/register", (req, res) => {
  const { nodeId, port: nodePort } = req.body;
  nodes[nodeId] = { nodeId, port: nodePort };
  res.json(nodes[nodeId]);
});

app.get("/nodes", (req, res) => {
  res.json(Object.values(nodes));
});

app.listen(port, () => {
  console.log(`SyncMesh Coordinator is running on http://localhost:${port}`);
});
