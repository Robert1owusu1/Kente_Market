// config/db.js
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const connectDB = async () => {
  try {
    const connection = await pool.getConnection();
    console.log("MySQL Connected Successfully");
    connection.release();
  } catch (error) {
    console.error("MySQL Connection Failed:", error.message);
    process.exit(1);
  }
};

// Export pool as default
export default pool;
export { connectDB };