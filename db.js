// api/db.js
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

// trim() quita espacios o saltos de línea invisibles que se cuelan al pegar variables en Render
const env = (nombre) => process.env[nombre]?.trim();

// El pool toma y libera las conexiones automáticamente en cada pool.execute()
const pool = mysql.createPool({
  host: env("DB_HOST"),
  port: Number(env("DB_PORT")),
  user: env("DB_USER"),
  password: env("DB_PASSWORD"),
  database: env("DB_NAME"),
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
