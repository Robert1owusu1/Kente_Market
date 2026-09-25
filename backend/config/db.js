// config/db.js
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { mysqlTls } from "./mysqlTls.js";

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  ssl: mysqlTls(),
  waitForConnections: true,
  // Pool size is tunable per environment (default 10). mysql2 has no
  // per-statement timeout, so a hung query holds a slot until connect/query
  // level timeouts fire — size this consciously and keep connectTimeout low.
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