import express from "express"
import usuario from "./routes/Ingreso.js"
import cartas from "./routes/Cartas.js"
import pool from "./db.js"
import cors from "cors"
import dotenv from "dotenv"
import path from "path"
import { fileURLToPath } from "url"

dotenv.config()

if (!process.env.JWT_SECRETO) {
    throw new Error("Falta JWT_SECRETO en las variables de entorno")
}

const app = express()

// Render funciona detrás de un proxy; necesario para que el límite de intentos vea la IP real
app.set("trust proxy", 1)

// FRONTEND_URL admite varios dominios separados por coma.
// Si no está definida se permite cualquier origen (comportamiento anterior).
const origenesPermitidos = process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(",").map((o) => o.trim())
    : null

if (!origenesPermitidos) {
    console.warn("⚠️ FRONTEND_URL no está definida: CORS acepta cualquier origen")
}

app.use(cors({ origin: origenesPermitidos ?? true }))
app.use(express.json({ limit: "100kb" }))

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use("/cartas", express.static(path.join(__dirname, "public/cartas")));

// Diagnóstico: indica si el servidor se conecta a la base de datos (solo devuelve el código de error)
app.get("/salud", async (req, res) => {
    try {
        await pool.execute("SELECT 1")
        res.json({ servidor: "ok", baseDatos: "ok" })
    } catch (error) {
        console.error("❌ ERROR EN /salud:", error)
        res.status(500).json({
            servidor: "ok",
            baseDatos: "error",
            codigo: error.code || null,
            variablesDefinidas: {
                DB_HOST: Boolean(process.env.DB_HOST),
                DB_PORT: Boolean(process.env.DB_PORT),
                DB_USER: Boolean(process.env.DB_USER),
                DB_PASSWORD: Boolean(process.env.DB_PASSWORD),
                DB_NAME: Boolean(process.env.DB_NAME),
            },
        })
    }
})

app.use("/usuario", usuario)
app.use("/cartas", cartas)

// Errores no controlados: se registran en el servidor, el cliente solo ve un mensaje genérico
app.use((err, req, res, next) => {
    console.error("❌ Error no controlado:", err)
    res.status(err.status || 500).json({ succes: false, message: "Error interno del servidor" })
})

const PORT = process.env.PORT || 4000

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`)
})
