import express from "express"
import usuario from "./routes/Ingreso.js"
import cartas from "./routes/Cartas.js"
import cors from "cors"
import dotenv from "dotenv"
import path from "path"
import { fileURLToPath } from "url"

dotenv.config()
const app = express()


app.use(cors())
app.use(express.json())

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use("/cartas", express.static(path.join(__dirname, "public/cartas")));
app.use("/imagenes", express.static("public/cartas"))

app.use("/usuario", usuario)
app.use("/cartas",cartas)

const PORT = process.env.PORT

app.listen(PORT,()=>{
    console.log(`Servidro corriendo en el puerto ${PORT}`)
})