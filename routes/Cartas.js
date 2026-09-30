import express from "express";
import connectDb from "../db.js";
import path from "path";
import multer from "multer";
import { pdf } from "pdf-to-img";
import fs from "fs";
import sharp from "sharp";

const router = express.Router();
const __dirname = path.resolve();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/cartas");
  },
  filename: (req, file, cb) => {
    cb(null, `pdf_${Date.now()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({ storage });

// Función para limpiar únicamente los archivos WebP del punto específico
const limpiarArchivosPunto = (punto_id, pdfAnterior = null) => {
  if (pdfAnterior) {
    const rutaPdf = path.join(__dirname, "public/cartas", pdfAnterior);
    if (fs.existsSync(rutaPdf)) {
      try { fs.unlinkSync(rutaPdf); } catch (e) {}
    }
  }

  const dir = path.join(__dirname, "public/cartas");
  if (fs.existsSync(dir)) {
    const archivos = fs.readdirSync(dir);
    archivos.forEach(archivo => {
      if (archivo.startsWith(`p${punto_id}_pag_`) && archivo.endsWith(".webp")) {
        try { fs.unlinkSync(path.join(dir, archivo)); } catch (e) {}
      }
    });
  }
};

// 1. Obtener cartas para el Administrador
router.get("/obtener_Cartas", async (req, res) => {
  try {
    const db = await connectDb();
    const [rows] = await db.execute("CALL obtenerCartas()");
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ succes: false, error: error.message });
  }
});

// 2. Obtener cartas para la Página Pública
router.get("/obtener_Cartas_Punto/:punto_id", async (req, res) => {
  const { punto_id } = req.params;

  try {
    const db = await connectDb();
    const [rows] = await db.execute("CALL obtenerCartasPorPunto(?)", [parseInt(punto_id)]);
    
    const cartasOriginales = rows[0] || [];
    const cartasProcesadas = [];

    const dir = path.join(__dirname, "public/cartas");

    for (let carta of cartasOriginales) {
      let paginasArray = [];

      if (fs.existsSync(dir)) {
        const archivos = fs.readdirSync(dir);
        const webpsPunto = archivos
          .filter(archivo => archivo.startsWith(`p${punto_id}_pag_`) && archivo.endsWith(".webp"))
          .sort((a, b) => {
            const numA = parseInt(a.split("_pag_")[1]);
            const numB = parseInt(b.split("_pag_")[1]);
            return numA - numB;
          });

        paginasArray = webpsPunto;
      }

      cartasProcesadas.push({
        ...carta,
        pages: paginasArray
      });
    }

    res.json(cartasProcesadas);
  } catch (error) {
    res.status(500).json({ succes: false, error: error.message });
  }
});

// 3. Crear o Reemplazar carta (Responde YA y procesa el PDF por detrás)
router.post("/crear_Cartas", upload.single("imagen"), async (req, res) => {
  const { punto_id } = req.body;
  const archivoSubido = req.file?.filename;

  if (!punto_id || !archivoSubido) {
    return res.status(400).json({ succes: false, message: "Ingrese los campos requeridos" });
  }

  // ⚡ 1. Respondemos inmediatamente al cliente para que no tenga que esperar 30 segundos
  res.status(201).json({ 
    succes: true, 
    message: "Carta recibida. Se está procesando y convirtiendo a WebP en segundo plano." 
  });

  // 🔄 2. Todo este bloque se ejecuta por detrás en segundo plano de manera totalmente independiente
  (async () => {
    try {
      const db = await connectDb();
      const puntoIdNum = parseInt(punto_id);
      
      // Limpiamos archivos anteriores de este punto
      const [rowsExistentes] = await db.execute("CALL obtenerCartasPorPunto(?)", [puntoIdNum]);
      if (rowsExistentes && rowsExistentes[0] && rowsExistentes[0].length > 0) {
        for (let cartaVieja of rowsExistentes[0]) {
          const archivoViejo = cartaVieja.pdf || cartaVieja.imagen;
          limpiarArchivosPunto(puntoIdNum, archivoViejo);
        }
      }

      const rutaPdfAbsoluta = path.join(__dirname, "public/cartas", archivoSubido);

      if (fs.existsSync(rutaPdfAbsoluta)) {
        console.log(`🚀 [Segundo Plano] Iniciando conversión a WebP para el punto ${puntoIdNum}...`);
        try {
          const document = await pdf(rutaPdfAbsoluta, { scale: 1.5 });
          let pageNum = 1;
          const promesasPaginas = [];

          for await (const image of document) {
            const currentNum = pageNum;
            const nombrePagina = `p${puntoIdNum}_pag_${currentNum}.webp`;
            const rutaImagenFinal = path.join(__dirname, "public/cartas", nombrePagina);
            
            const promesaConversion = sharp(image)
              .webp({ quality: 75 })
              .toFile(rutaImagenFinal);

            promesasPaginas.push(promesaConversion);
            pageNum++;
          }

          await Promise.all(promesasPaginas);
          console.log(`✅ [Segundo Plano] Todas las páginas WebP listas para el punto ${puntoIdNum}`);
        } catch (convError) {
          console.error("❌ Error en segundo plano convirtiendo PDF a WebP:", convError);
        }
      }

      // Guardamos en la base de datos una vez finalizado el proceso de imágenes
      await db.execute("CALL insertarCarta(?,?)", [puntoIdNum, archivoSubido]);
      console.log(`✅ [Segundo Plano] Registro guardado en la base de datos para el punto ${puntoIdNum}`);

    } catch (bgError) {
      console.error("❌ ERROR CRÍTICO EN SEGUNDO PLANO:", bgError);
    }
  })();
});

// 4. Eliminar carta
router.delete("/eliminar_Carta/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const db = await connectDb();
    const [rowsCarta] = await db.execute("SELECT * FROM cartas WHERE id = ?", [parseInt(id)]);
    
    if (rowsCarta && rowsCarta.length > 0) {
      const carta = rowsCarta[0];
      const archivoAsociado = carta.pdf || carta.imagen;
      const puntoIdAsociado = carta.punto_id;
      
      limpiarArchivosPunto(puntoIdAsociado, archivoAsociado);
    }

    await db.execute("CALL eliminarCarta(?)", [parseInt(id)]);
    res.json({ succes: true, message: "Eliminado correctamente" });
  } catch (error) {
    console.error("❌ ERROR EN /eliminar_Carta:", error);
    res.status(500).json({ succes: false, error: error.message });
  }
});

export default router;