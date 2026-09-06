const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.join(__dirname, "syncmesh.db"));

db.exec(`
CREATE TABLE IF NOT EXISTS nodes (
  nodeId TEXT PRIMARY KEY,
  port INTEGER,
  lastSeen INTEGER,
  status TEXT
);

CREATE TABLE IF NOT EXISTS files (
  filePath TEXT,
  hash TEXT,
  version INTEGER,
  nodeId TEXT,
  updatedAt INTEGER,
  deleted INTEGER,
  PRIMARY KEY (nodeId, filePath)
);
`);

module.exports = db;
