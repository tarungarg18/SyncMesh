# SyncMesh

SyncMesh is a small distributed file-sync prototype. Independent Node Agents watch local folders, report changes to a Coordinator, and pull missing or newer files from each other. A React dashboard shows node status, file copies, hashes, and live events.

The number of nodes is not hardcoded. Any agent that registers with a unique ID, port, and storage folder is included.

## Architecture

```
storage/node1  -->  Node Agent :5001  --\
storage/node2  -->  Node Agent :5002  ---->  Coordinator :8000  -->  Dashboard :5173
storage/node3  -->  Node Agent :5003  --/
```

1. A node watches its storage folder.
2. On create/modify it computes SHA-256 and POSTs `/files/change`.
3. The coordinator records metadata in SQLite and tells other online nodes to `/pull`.
4. The target node downloads the file, checks the hash, and writes it locally.
5. Socket.IO notifies the dashboard so it can reload REST data.

## Requirements

- Node.js 22+ (uses built-in `node:sqlite` and `fetch`)

## Install

```bash
cd coordinator
npm install

cd ../node
npm install

cd ../dashboard
npm install
```

## Run

Use three terminals.

**Terminal 1 — Coordinator**

```bash
cd coordinator
npm start
```

Runs at http://localhost:8000

**Terminal 2 — Nodes**

```bash
cd node
npm run node1
```

Open more terminals for more nodes:

```bash
npm run node2
npm run node3
npm run node4
```

| Script | Node ID | Port | Storage |
|--------|---------|------|---------|
| `npm run node1` | node1 | 5001 | `storage/node1` |
| `npm run node2` | node2 | 5002 | `storage/node2` |
| `npm run node3` | node3 | 5003 | `storage/node3` |
| `npm run node4` | node4 | 5004 | `storage/node4` |

Any extra node, no code change:

```bash
node agent.js node5 5005
```

That uses `storage/node5`.

**Terminal 3 — Dashboard**

```bash
cd dashboard
npm start
```

Open http://127.0.0.1:5173

## How sync works

| Action | Where | Result |
|--------|--------|--------|
| Create or edit a file | `storage/node1` | Other online nodes pull the same bytes and hash |
| Delete a file | `storage/node1` | Other online nodes delete their copy; SQLite keeps `deleted = 1` |
| Stop a node | Ctrl+C on that agent | After about 10 seconds the dashboard shows OFFLINE |
| Start it again | `npm run node2` | It registers and recovers missing files |
| Edit the same file on two nodes at once | two storage folders | CONFLICT — both hashes are kept, nothing is silently overwritten |

Click a file in the dashboard to compare version, SHA-256, and present/deleted state on each node.

## Tests you can run by hand

1. **Create** — Put `hello.txt` in `storage/node1`. It should appear in `storage/node2` and `storage/node3` with the same content and SHA-256.
2. **Modify** — Change `hello.txt` on node1. Other nodes update.
3. **Delete** — Delete `hello.txt` on node1. Other nodes remove it. Coordinator `GET /files` still has the row with `deleted: 1`.
4. **Offline** — Stop node2, wait ~10 seconds, create a new file on node1. Node3 still gets it. Node2 does not until it returns.
5. **Recovery** — Start node2 again. It should download missing files.
6. **Conflict** — Edit `hello.txt` on node1 and node2 to different text at the same time. Dashboard status becomes CONFLICT. Both copies remain.
7. **Dynamic node** — `npm run node4` with no backend change. It shows as ONLINE.

## API

Coordinator (port 8000):

- `GET /` — health
- `GET /nodes` — registered nodes and ONLINE/OFFLINE
- `GET /files` — per-node file metadata (path, hash, version, deleted)
- `GET /activity` — recent events (in memory while the coordinator is running)
- `POST /nodes/register` — `{ nodeId, port }`
- `POST /nodes/heartbeat` — `{ nodeId }`
- `POST /files/change` — `{ nodeId, fileName, operation, hash? }`

Socket.IO events: `FILE_CHANGED`, `FILE_SYNCED`, `NODE_STATUS_CHANGED`.



## Project layout

```
coordinator/     Express + SQLite + Socket.IO
node/            Node Agent (watch folder, pull, recover)
dashboard/       React + Vite dashboard
storage/         One folder per node
```
