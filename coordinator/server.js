const express = require("express");

const app = express();
const port = 8000;

app.get("/", (req, res) => {
  res.send("SyncMesh Coordinator is running");
});

app.listen(port, () => {
  console.log(`SyncMesh Coordinator is running on http://localhost:${port}`);
});
