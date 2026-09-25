// config/db.js
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { mysqlTls } from "./mysqlTls.js";

dotenv.config();

const intEnv = (name, fallback) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// mysql2 has no per-statement timeout: a query issued on a connection whose
// peer silently died (VPN blip, serverless DB closing idle sockets without a
// FIN) never settles, holds its pool slot forever, and the whole API slowly
// wedges while /health can still answer from whichever slot is alive. These
// three guards were added after reproducing exactly that: sequential requests
// fine, parallel cache-miss requests hanging indefinitely.
const DB_QUERY_TIMEOUT_MS = intEnv('DB_QUERY_TIMEOUT_MS', 12000); // < frontend's 15s fetch timeout so callers get a real error
const DB_SOCKET_IDLE_MS = intEnv('DB_SOCKET_IDLE_MS', 90000);      // backstop: no bytes for this long => destroy socket
const DB_PING_INTERVAL_MS = intEnv('DB_PING_INTERVAL_MS', 30000); // keep sockets warm + detect dead peers proactively
const DB_PING_TIMEOUT_MS = intEnv('DB_PING_TIMEOUT_MS', 5000);

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  ssl: mysqlTls(),
  waitForConnections: true,
  // Pool size is tunable per environment (default 10). Size this consciously:
  // a hung query still holds a slot until one of the deadlines below fires.
  connectionLimit: Math.min(50, Math.max(1, parseInt(process.env.DB_POOL_SIZE, 10) || 10)),
  queueLimit: 0,
  // Connection latency is the dominant cost on this topology (TLS handshake to
  // a remote TiDB + cold start when the host idles). Fail fast on a dead
  // connection instead of queueing, and keep idle sockets alive so the pool
  // stays warm between requests.
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

// ---------------------------------------------------------------------------
// Guard 1: statement deadline. Wraps the promise-mode pool API so every
// query/execute rejects with a clear error after DB_QUERY_TIMEOUT_MS instead
// of hanging the request. Callback-style calls are left untouched (none exist
// in this codebase, but be safe). A late-settling original promise is still
// observed by the race, so no unhandled rejection can escape.
// ---------------------------------------------------------------------------
const withDeadline = async (promise, ms, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const rawQuery = pool.query.bind(pool);
const rawExecute = pool.execute.bind(pool);
pool.query = (...args) => withDeadline(rawQuery(...args), DB_QUERY_TIMEOUT_MS, 'DB query');
pool.execute = (...args) => withDeadline(rawExecute(...args), DB_QUERY_TIMEOUT_MS, 'DB execute');

// ---------------------------------------------------------------------------
// Guards 2 + 3: socket idle kill + warm ping. The pool emits 'connection' for
// each freshly established connection (after connect succeeds). We track those
// sockets so that (a) an inactivity deadline destroys connections whose peer
// vanished silently — the in-flight command errors out and the pool discards
// the socket — and (b) a small SELECT 1 every DB_PING_INTERVAL_MS keeps every
// healthy socket warm (defeating serverless idle-kills, resetting the idle
// timer) while dead ones are destroyed within DB_PING_TIMEOUT_MS instead of
// waiting for a customer request to trip over them.
// ---------------------------------------------------------------------------
const trackedSockets = new Set();

pool.on('connection', (conn) => {
  const sock = conn.stream;
  if (!sock) return;
  trackedSockets.add(sock);
  sock._poolConnection = conn; // back-reference for the warm ping below
  sock.once('close', () => trackedSockets.delete(sock));
  sock.setTimeout(DB_SOCKET_IDLE_MS);
  sock.on('timeout', () => {
    sock.destroy(new Error(`DB socket idle for ${DB_SOCKET_IDLE_MS}ms`));
  });
});

let pinging = false;
const pingSockets = () => {
  if (pinging || trackedSockets.size === 0) return;
  pinging = true;
  const attempts = [...trackedSockets].map((sock) => {
    const conn = sock._poolConnection ?? null;
    const ping = conn
      ? new Promise((resolve, reject) =>
          conn.query('SELECT 1', (err, rows) => (err ? reject(err) : resolve(rows)))
        )
      : Promise.reject(new Error('no pool connection bound to socket'));
    return withDeadline(ping, DB_PING_TIMEOUT_MS, 'DB ping').catch(() => {
      sock.destroy(new Error('DB ping failed'));
    });
  });
  Promise.all(attempts).finally(() => {
    pinging = false;
  });
};

setInterval(pingSockets, DB_PING_INTERVAL_MS).unref?.();

// Warm a few connections at boot so the first request doesn't pay a full
// TLS handshake. The pool lazily creates the rest up to connectionLimit.
const warmPool = async () => {
  const warm = Math.min(parseInt(process.env.DB_WARM_CONNECTIONS) || 4, 10);
  const acquired = [];
  try {
    for (let i = 0; i < warm; i++) {
      acquired.push(await pool.getConnection());
    }
  } finally {
    acquired.forEach((c) => c.release());
  }
};

const connectDB = async () => {
  try {
    await warmPool();
    console.log("MySQL Connected Successfully");
  } catch (error) {
    console.error("MySQL Connection Failed:", error.message);
    process.exit(1);
  }
};

// Export pool as default
export default pool;
export { connectDB };