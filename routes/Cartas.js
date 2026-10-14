import express from "express";
import pool from "../db.js";
import path from "path";
import multer from "multer";
import { pdf } from "pdf-to-img";
import fs from "fs";
import sharp from "sharp";
import { fileURLToPath } from "url";
import { verificarToken, soloAdmin } from "../middleware/auth.js";

const router = express.Router();

// Ruta absoluta a public/cartas, sin importar desde qué carpeta se arranque el servidor
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR_CARTAS = path.join(__dirname, "..", "public/cartas");

fs.mkdirSync(DIR_CARTAS, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, DIR_CARTAS);
  },
  filename: (req, file, cb) => {
    cb(null, `pdf_${Date.now()}.pdf`);
  },
});

// Solo PDF y máximo 20 MB
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const esPdf =
      file.mimetype === "application/pdf" &&
      path.extname(file.originalname).toLowerCase() === ".pdf";

    if (!esPdf) {
      return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "imagen"));
    }
    cb(null, true);
  },
});

// Ejecuta multer y convierte sus errores en respuestas 400 claras
const subirPdf = (req, res, next) => {
  upload.single("imagen")(req, res, (err) => {
    if (!err) return next();

    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "El PDF no puede pesar más de 20 MB"
        : "Solo se permiten archivos PDF";

    return res.status(400).json({ succes: false, message });
  });
};

const esIdValido = (valor) => Number.isInteger(Number(valor)) && Number(valor) > 0;

// Función para limpiar únicamente los archivos WebP del punto específico
const limpiarArchivosPunto = (punto_id, pdfAnterior = null) => {
  if (pdfAnterior) {
    // basename evita que un nombre como "../algo" salga de la carpeta de cartas
    const rutaPdf = path.join(DIR_CARTAS, path.basename(pdfAnterior));
    if (fs.existsSync(rutaPdf)) {
      try { fs.unlinkSync(rutaPdf); } catch (e) {}
    }
  }

  if (fs.existsSync(DIR_CARTAS)) {
    const archivos = fs.readdirSync(DIR_CARTAS);
    archivos.forEach(archivo => {
      if (archivo.startsWith(`p${punto_id}_pag_`) && archivo.endsWith(".webp")) {
        try { fs.unlinkSync(path.join(DIR_CARTAS, archivo)); } catch (e) {}
      }
    });
  }
};

// 1. Obtener cartas para el Administrador
router.get("/obtener_Cartas", verificarToken, soloAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute("CALL obtenerCartas()");
    res.json(rows[0]);
  } catch (error) {
    console.error("❌ ERROR EN /obtener_Cartas:", error);
    res.status(500).json({ succes: false, message: "Error al obtener cartas" });
  }
});

// 2. Obtener cartas para la Página Pública
router.get("/obtener_Cartas_Punto/:punto_id", async (req, res) => {
  const { punto_id } = req.params;

  if (!esIdValido(punto_id)) {
    return res.status(400).json({ succes: false, message: "Punto inválido" });
  }

  const puntoIdNum = Number(punto_id);

  try {
    const [rows] = await pool.execute("CALL obtenerCartasPorPunto(?)", [puntoIdNum]);

    const cartasOriginales = rows[0] || [];
    const cartasProcesadas = [];

    for (let carta of cartasOriginales) {
      let paginasArray = [];

      if (fs.existsSync(DIR_CARTAS)) {
        const archivos = fs.readdirSync(DIR_CARTAS);
        const webpsPunto = archivos
          .filter(archivo => archivo.startsWith(`p${puntoIdNum}_pag_`) && archivo.endsWith(".webp"))
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
    console.error("❌ ERROR EN /obtener_Cartas_Punto:", error);
    res.status(500).json({ succes: false, message: "Error al obtener cartas" });
  }
});

// 3. Crear o Reemplazar carta (Responde YA y procesa el PDF por detrás)
// verificarToken va antes de subirPdf: sin sesión el archivo ni siquiera se guarda
router.post("/crear_Cartas", verificarToken, soloAdmin, subirPdf, async (req, res) => {
  const { punto_id } = req.body;
  const archivoSubido = req.file?.filename;

  if (!esIdValido(punto_id) || !archivoSubido) {
    if (archivoSubido) {
      try { fs.unlinkSync(path.join(DIR_CARTAS, archivoSubido)); } catch (e) {}
    }
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
      const puntoIdNum = Number(punto_id);

      // Limpiamos archivos anteriores de este punto
      const [rowsExistentes] = await pool.execute("CALL obtenerCartasPorPunto(?)", [puntoIdNum]);
      if (rowsExistentes && rowsExistentes[0] && rowsExistentes[0].length > 0) {
        for (let cartaVieja of rowsExistentes[0]) {
          const archivoViejo = cartaVieja.pdf || cartaVieja.imagen;
          limpiarArchivosPunto(puntoIdNum, archivoViejo);
        }
      }

      const rutaPdfAbsoluta = path.join(DIR_CARTAS, archivoSubido);

      if (fs.existsSync(rutaPdfAbsoluta)) {
        console.log(`🚀 [Segundo Plano] Iniciando conversión a WebP para el punto ${puntoIdNum}...`);
        try {
          const document = await pdf(rutaPdfAbsoluta, { scale: 1.5 });
          let pageNum = 1;
          const promesasPaginas = [];

          for await (const image of document) {
            const currentNum = pageNum;
            const nombrePagina = `p${puntoIdNum}_pag_${currentNum}.webp`;
            const rutaImagenFinal = path.join(DIR_CARTAS, nombrePagina);

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
      await pool.execute("CALL insertarCarta(?,?)", [puntoIdNum, archivoSubido]);
      console.log(`✅ [Segundo Plano] Registro guardado en la base de datos para el punto ${puntoIdNum}`);

    } catch (bgError) {
      console.error("❌ ERROR CRÍTICO EN SEGUNDO PLANO:", bgError);
    }
  })();
});

// 4. Eliminar carta
router.delete("/eliminar_Carta/:id", verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;

  if (!esIdValido(id)) {
    return res.status(400).json({ succes: false, message: "ID inválido" });
  }

  try {
    const [rowsCarta] = await pool.execute("SELECT * FROM cartas WHERE id = ?", [Number(id)]);

    if (rowsCarta && rowsCarta.length > 0) {
      const carta = rowsCarta[0];
      const archivoAsociado = carta.pdf || carta.imagen;
      const puntoIdAsociado = carta.punto_id;

      limpiarArchivosPunto(puntoIdAsociado, archivoAsociado);
    }

    await pool.execute("CALL eliminarCarta(?)", [Number(id)]);
    res.json({ succes: true, message: "Eliminado correctamente" });
  } catch (error) {
    console.error("❌ ERROR EN /eliminar_Carta:", error);
    res.status(500).json({ succes: false, message: "Error al eliminar la carta" });
  }
});

export default router;
