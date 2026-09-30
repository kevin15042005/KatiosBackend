import express from "express";
import connectDb from "../db.js";
import path from "path";
import multer from "multer";
import { pdf } from "pdf-to-img";
import fs from "fs";
import sharp from "sharp"; // 👈 Importamos sharp para convertir a webp

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

// Función para limpiar únicamente los archivos del punto específico (ahora buscando .webp)
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
      // Borra exclusivamente los webps que pertenecen a este punto_id
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

// 2. Obtener cartas para la Página Pública (HTMLFlipBook) - Lee los WebPs generados
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
        // Filtramos y ordenamos estrictamente las páginas webp de este punto
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

// 3. Crear o Reemplazar carta (Convierte el PDF directamente a WebP)
router.post("/crear_Cartas", upload.single("imagen"), async (req, res) => {
  const { punto_id } = req.body;
  const archivoSubido = req.file?.filename;

  if (!punto_id || !archivoSubido) {
    return res.status(400).json({ succes: false, message: "Ingrese los campos requeridos" });
  }

  try {
    const db = await connectDb();
    const puntoIdNum = parseInt(punto_id);
    
    // 1. Buscamos si ya existía una carta previa para limpiar archivos anteriores
    const [rowsExistentes] = await db.execute("CALL obtenerCartasPorPunto(?)", [puntoIdNum]);
    if (rowsExistentes && rowsExistentes[0] && rowsExistentes[0].length > 0) {
      for (let cartaVieja of rowsExistentes[0]) {
        const archivoViejo = cartaVieja.pdf || cartaVieja.imagen;
        limpiarArchivosPunto(puntoIdNum, archivoViejo);
      }
    }

    const rutaPdfAbsoluta = path.join(__dirname, "public/cartas", archivoSubido);

    // 2. Convertimos el PDF a imágenes WebP usando Sharp
    if (fs.existsSync(rutaPdfAbsoluta)) {
      console.log(`🚀 Generando páginas WebP para el flipbook del punto ${puntoIdNum}...`);
      try {
        const document = await pdf(rutaPdfAbsoluta, { scale: 2 });
        let pageNum = 1;

        for await (const image of document) {
          const nombrePagina = `p${puntoIdNum}_pag_${pageNum}.webp`;
          const rutaImagenFinal = path.join(__dirname, "public/cartas", nombrePagina);
          
          // Convertimos el buffer de la imagen del PDF a WebP con calidad 85
          await sharp(image)
            .webp({ quality: 85 })
            .toFile(rutaImagenFinal);

          pageNum++;
        }
        console.log(`✅ Páginas WebP generadas con éxito para el punto ${puntoIdNum}`);
      } catch (convError) {
        console.error("❌ Error convirtiendo PDF a WebP:", convError);
      }
    }

    // 3. Guardamos el nombre del PDF en la base de datos
    await db.execute("CALL insertarCarta(?,?)", [puntoIdNum, archivoSubido]);

    res.status(201).json({ succes: true, message: "Carta subida y convertida a WebP con éxito" });
  } catch (error) {
    console.error("❌ ERROR EN /crear_Cartas:", error);
    res.status(500).json({ succes: false, error: error.message });
  }
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