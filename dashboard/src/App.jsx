import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

function formatTime(value) {
  if (!value) {
    return "--:--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function shortHash(hash) {
  if (!hash) {
    return "-";
  }
  if (hash.length <= 16) {
    return hash;
  }
  return hash.slice(0, 10) + "..." + hash.slice(-6);
}

function activityText(item) {
  if (item.text) {
    return item.text;
  }
  const name = item.fileName || item.filePath || "file";
  const node = item.nodeId || "";
  if (item.operation === "DELETE") {
    return name + " deleted on " + node;
  }
  if (item.operation === "CREATE") {
    return name + " created on " + node;
  }
  if (item.operation === "MODIFY") {
    return name + " changed on " + node;
  }
  if (item.operation === "SYNCED") {
    return name + " synced to " + node;
  }
  if (item.operation === "CONFLICT") {
    return name + " conflict on " + node + " (both versions kept)";
  }
  if (item.operation) {
    return name + " " + String(item.operation).toLowerCase() + " on " + node;
  }
  return name;
}

function groupFiles(rows) {
  const groups = {};
  for (const row of rows) {
    const name = row.filePath || row.fileName;
    if (!name) {
      continue;
    }
    if (!groups[name]) {
      groups[name] = [];
    }
    groups[name].push(row);
  }
  return Object.keys(groups)
    .sort()
    .map((name) => ({
      name,
      copies: groups[name].slice().sort((a, b) => String(a.nodeId).localeCompare(String(b.nodeId))),
    }));
}

function fileStatus(copies, onlineIds) {
  const active = copies.filter((copy) => !copy.deleted);
  if (copies.length > 0 && active.length === 0) {
    return "DELETED";
  }
  const hashes = [];
  for (const copy of active) {
    if (copy.hash && hashes.indexOf(copy.hash) === -1) {
      hashes.push(copy.hash);
    }
  }
  if (hashes.length > 1) {
    return "CONFLICT";
  }
  const hasFile = {};
  for (const copy of active) {
    hasFile[copy.nodeId] = true;
  }
  for (const id of onlineIds) {
    if (!hasFile[id]) {
      return "PARTIAL";
    }
  }
  return "SYNCED";
}

function App() {
  const [nodes, setNodes] = useState([]);
  const [fileRows, setFileRows] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [openFile, setOpenFile] = useState("");
  const [lastEvent, setLastEvent] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const nodesRes = await fetch("/nodes");
        if (!nodesRes.ok) {
          throw new Error("nodes");
        }
        const nodesData = await nodesRes.json();

        let filesData = [];
        let activityData = [];
        try {
          const filesRes = await fetch("/files");
          if (filesRes.ok) {
            filesData = await filesRes.json();
          }
        } catch (err) {}
        try {
          const activityRes = await fetch("/activity");
          if (activityRes.ok) {
            activityData = await activityRes.json();
          }
        } catch (err) {}

        if (!cancelled) {
          setNodes(Array.isArray(nodesData) ? nodesData : []);
          setFileRows(Array.isArray(filesData) ? filesData : []);
          setActivity(Array.isArray(activityData) ? activityData : []);
          setError("");
          setLoading(false);
          setUpdatedAt(Date.now());
        }
      } catch (err) {
        if (!cancelled) {
          setError("Coordinator is not reachable on port 8000. Start it, then click Refresh.");
          setLoading(false);
          setLive(false);
        }
      }
    }

    load();
    const socket = io("http://localhost:8000");
    socket.on("connect", () => {
      if (!cancelled) {
        setLive(true);
        setError("");
        load();
      }
    });
    socket.on("disconnect", () => {
      if (!cancelled) {
        setLive(false);
      }
    });
    socket.on("connect_error", () => {
      if (!cancelled) {
        setLive(false);
      }
    });
    function onFileChanged(event) {
      setLastEvent(activityText(event || {}));
      load();
    }
    function onFileSynced(event) {
      const item = event || {};
      if (item.status === "CONFLICT") {
        setLastEvent((item.fileName || "file") + " conflict on " + (item.nodeId || "node"));
      } else {
        setLastEvent((item.fileName || "file") + " synced to " + (item.nodeId || "node"));
      }
      load();
    }
    function onNodeStatus() {
      setLastEvent("Node status updated");
      load();
    }
    socket.on("FILE_CHANGED", onFileChanged);
    socket.on("FILE_SYNCED", onFileSynced);
    socket.on("NODE_STATUS_CHANGED", onNodeStatus);
    return () => {
      cancelled = true;
      socket.off("FILE_CHANGED", onFileChanged);
      socket.off("FILE_SYNCED", onFileSynced);
      socket.off("NODE_STATUS_CHANGED", onNodeStatus);
      socket.disconnect();
    };
  }, []);

  const onlineIds = nodes.filter((node) => node.status === "ONLINE").map((node) => node.nodeId);
  const files = groupFiles(fileRows);
  const onlineCount = onlineIds.length;
  const conflictCount = files.filter((file) => fileStatus(file.copies, onlineIds) === "CONFLICT").length;

  async function refresh() {
    setLoading(true);
    try {
      const nodesRes = await fetch("/nodes");
      if (!nodesRes.ok) {
        throw new Error("nodes");
      }
      const nodesData = await nodesRes.json();
      let filesData = [];
      let activityData = [];
      const filesRes = await fetch("/files");
      if (filesRes.ok) {
        filesData = await filesRes.json();
      }
      const activityRes = await fetch("/activity");
      if (activityRes.ok) {
        activityData = await activityRes.json();
      }
      setNodes(Array.isArray(nodesData) ? nodesData : []);
      setFileRows(Array.isArray(filesData) ? filesData : []);
      setActivity(Array.isArray(activityData) ? activityData : []);
      setError("");
      setUpdatedAt(Date.now());
    } catch (err) {
      setError("Coordinator is not reachable on port 8000. Start it, then click Refresh.");
    }
    setLoading(false);
  }

  return (
    <div className="page">
      <div className="dashboard">
        <header className="dashboard-header">
          <div>
            <div className="title">SyncMesh</div>
            <div className="subtitle">Distributed file sync across nodes</div>
          </div>
          <div className="header-actions">
            <span className={live ? "pill live" : "pill dead"}>{live ? "LIVE" : "OFFLINE"}</span>
            <button type="button" className="btn" onClick={refresh}>
              Refresh
            </button>
          </div>
        </header>

        <div className="stats">
          <div className="stat">
            <div className="stat-label">Nodes online</div>
            <div className="stat-value">
              {onlineCount}/{nodes.length}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Files</div>
            <div className="stat-value">{files.length}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Conflicts</div>
            <div className={"stat-value " + (conflictCount ? "warn" : "")}>{conflictCount}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Last update</div>
            <div className="stat-value small">{updatedAt ? formatTime(updatedAt) : "-"}</div>
          </div>
        </div>

        {lastEvent && <div className="banner">{lastEvent}</div>}
        {loading && <p className="message">Loading coordinator data...</p>}
        {error && <p className="message error">{error}</p>}

        <section>
          <h2>Nodes</h2>
          <p className="hint">Any new agent that registers is listed. Count is not hardcoded.</p>
          {nodes.length === 0 && !loading && (
            <p className="empty">No nodes yet. Run npm run node1 in the node folder.</p>
          )}
          {nodes.map((node) => (
            <div key={node.nodeId} className="node-row">
              <div>
                <div className="node-id">{node.nodeId}</div>
                <div className="muted">port {node.port}</div>
              </div>
              <span className={node.status === "ONLINE" ? "pill online" : "pill offline"}>
                {node.status || "UNKNOWN"}
              </span>
            </div>
          ))}
        </section>

        <section>
          <h2>Files</h2>
          <p className="hint">Click a file to compare the copy on each node. Different hashes mean a conflict.</p>
          {files.length === 0 && !loading && (
            <p className="empty">No files yet. Create a text file inside storage/node1.</p>
          )}
          {files.map((file) => {
            const status = fileStatus(file.copies, onlineIds);
            const latest = file.copies.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
            const open = openFile === file.name;
            return (
              <div key={file.name} className="file-card">
                <button
                  type="button"
                  className="file-head"
                  onClick={() => setOpenFile(open ? "" : file.name)}
                >
                  <div>
                    <div className="file-name">{file.name}</div>
                    <div className="muted">
                      latest v{latest ? latest.version : "-"} on {latest ? latest.nodeId : "-"}
                    </div>
                  </div>
                  <span className={"pill " + status.toLowerCase()}>{status}</span>
                </button>
                {open && (
                  <div className="copies">
                    {file.copies.map((copy) => (
                      <div key={copy.nodeId} className="copy">
                        <div className="copy-top">
                          <strong>{copy.nodeId}</strong>
                          <span className={copy.deleted ? "pill deleted" : "pill synced"}>
                            {copy.deleted ? "DELETED" : "PRESENT"}
                          </span>
                        </div>
                        <div>Version v{copy.version}</div>
                        <div className="hash" title={copy.hash || ""}>
                          SHA-256 {shortHash(copy.hash)}
                        </div>
                        <div className="muted">updated {formatTime(copy.updatedAt)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <section>
          <h2>Recent Activity</h2>
          <p className="hint">Live events from the coordinator. SYNCED means another node pulled the file.</p>
          {activity.length === 0 && !loading && (
            <p className="empty">No activity yet. Create or edit a file on a node.</p>
          )}
          {activity.slice(0, 40).map((item, index) => (
            <div key={index} className={"event " + String(item.operation || "").toLowerCase()}>
              <span className="event-time">{formatTime(item.time || item.updatedAt)}</span>
              <span>{activityText(item)}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

export default App;
