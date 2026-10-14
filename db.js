// api/db.js
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

// El pool toma y libera las conexiones automáticamente en cada pool.execute()
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  timezone: "local",
  charset: "utf8mb4",
  ssl: {
    rejectUnauthorized: false // Necesario para la conexión externa a Railway
  }
});

export default pool;
