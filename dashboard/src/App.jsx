import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

function latestFiles(rows) {
  const byPath = {};
  for (const row of rows) {
    const name = row.filePath || row.fileName;
    if (!name) {
      continue;
    }
    const current = byPath[name];
    if (!current || (row.updatedAt || 0) > (current.updatedAt || 0)) {
      byPath[name] = { ...row, name };
    }
  }
  return Object.values(byPath);
}

function formatTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function activityText(item) {
  if (item.text) {
    return item.text;
  }
  const name = item.fileName || item.filePath || "file";
  const node = item.nodeId ? ` on ${item.nodeId}` : "";
  if (item.operation === "DELETE") {
    return `${name} deleted${node}`;
  }
  if (item.operation === "CREATE") {
    return `${name} created${node}`;
  }
  if (item.operation === "MODIFY") {
    return `${name} changed${node}`;
  }
  if (item.operation === "SYNCED") {
    return `${name} synced to ${item.nodeId}`;
  }
  if (item.operation === "CONFLICT") {
    return `${name} CONFLICT on ${item.nodeId}`;
  }
  if (item.operation) {
    return `${name} ${String(item.operation).toLowerCase()}${node}`;
  }
  return name;
}

function App() {
  const [nodes, setNodes] = useState([]);
  const [files, setFiles] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
          setFiles(latestFiles(Array.isArray(filesData) ? filesData : []));
          setActivity(Array.isArray(activityData) ? activityData : []);
          setError("");
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Could not load data from coordinator");
          setLoading(false);
        }
      }
    }

    load();
    const socket = io("http://localhost:8000");
    function refresh() {
      load();
    }
    socket.on("FILE_CHANGED", refresh);
    socket.on("FILE_SYNCED", refresh);
    socket.on("NODE_STATUS_CHANGED", refresh);
    return () => {
      cancelled = true;
      socket.off("FILE_CHANGED", refresh);
      socket.off("FILE_SYNCED", refresh);
      socket.off("NODE_STATUS_CHANGED", refresh);
      socket.disconnect();
    };
  }, []);

  return (
    <div className="dashboard">
      <header className="dashboard-header">SyncMesh</header>

      {loading && <p className="message">Loading...</p>}
      {error && <p className="message">{error}</p>}

      <section>
        <h2>Nodes</h2>
        <hr />
        {nodes.map((node) => (
          <div key={node.nodeId} className="row">
            <span>{node.nodeId}</span>
            <span>:{node.port}</span>
            <span>{node.status}</span>
          </div>
        ))}
        {!loading && nodes.length === 0 && <p className="empty">No nodes</p>}
      </section>

      <section>
        <h2>Files</h2>
        <hr />
        {files.map((file) => (
          <div key={file.name} className="file">
            <div className="file-name">{file.name}</div>
            <div>Version: v{file.version}</div>
            <div className="hash">Hash: {file.hash || "-"}</div>
            <div>Node: {file.nodeId}</div>
            <div>Status: {file.deleted ? "DELETED" : "SYNCED"}</div>
          </div>
        ))}
        {!loading && files.length === 0 && <p className="empty">No files</p>}
      </section>

      <section>
        <h2>Recent Activity</h2>
        <hr />
        {activity.map((item, index) => (
          <div key={index} className="row">
            <span>{formatTime(item.time || item.updatedAt)}</span>
            <span>{activityText(item)}</span>
          </div>
        ))}
        {!loading && activity.length === 0 && <p className="empty">No activity</p>}
      </section>
    </div>
  );
}

export default App;
