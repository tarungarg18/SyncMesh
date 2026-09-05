const http = require("http");

const port = 3000;

const server = http.createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ message: "SyncMesh coordinator is running" }));
});

server.listen(port, () => {
  console.log(`SyncMesh coordinator running at http://localhost:${port}`);
});
