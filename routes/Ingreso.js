import express from "express";
import pool from "../db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { verificarToken, soloAdmin } from "../middleware/auth.js";

const router = express.Router();

const regexContrasena = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;

// Máximo 5 intentos cada 15 minutos por IP (evita adivinar contraseñas o PINs)
const limiteIntentos = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true, // solo cuentan los intentos fallidos
  message: {
    succes: false,
    message: "Demasiados intentos. Espere 15 minutos e intente de nuevo",
  },
});

const esIdValido = (valor) => Number.isInteger(Number(valor)) && Number(valor) > 0;

router.post("/entrada_usuario", limiteIntentos, async (req, res) => {
  const { nombre, contrasena } = req.body;

  if (typeof nombre !== "string" || typeof contrasena !== "string" || !nombre || !contrasena) {
    return res.status(400).json({
      succes: false,
      message: "Todos los campos son requeridos para el ingreso",
    });
  }

  try {
    const [rows] = await pool.execute("CALL entradaUsuario(?)", [nombre]);
    const usuario = rows[0]?.[0];

    let passwordMatch = false;

    if (usuario) {
      const estaCifrada = typeof usuario.contrasena === "string" && usuario.contrasena.startsWith("$2");

      if (estaCifrada) {
        passwordMatch = await bcrypt.compare(contrasena, usuario.contrasena);
      } else if (contrasena === usuario.contrasena) {
        // Usuario antiguo con contraseña sin cifrar: se cifra ahora mismo
        passwordMatch = true;
        const hash = await bcrypt.hash(contrasena, 10);
        await pool.execute("UPDATE usuario SET contrasena = ? WHERE id = ?", [hash, usuario.id]);
      }
    }

    if (!passwordMatch) {
      return res.status(401).json({
        succes: false,
        message: "Usuario o contraseña incorrecta",
      });
    }

    const payload = {
      id: usuario.id,
      nombre: usuario.nombre_usuario,
      es_admin: usuario.es_admin,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRETO, {
      expiresIn: "4h",
    });

    return res.status(200).json({
      succes: true,
      message: "Ingreso correcto",
      token: token,
      usuario: payload,
    });
  } catch (error) {
    console.error("❌ ERROR EN /entrada_usuario:", error);
    return res.status(500).json({
      succes: false,
      message: "Error al iniciar sesion",
    });
  }
});

router.get("/obtener_usuario", verificarToken, soloAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute("CALL obtenerUsuarios()");
    // Nunca enviar contraseñas ni PINs al navegador
    const usuarios = rows[0].map(({ id, nombre_usuario, es_admin }) => ({
      id,
      nombre_usuario,
      es_admin,
    }));
    res.json(usuarios);
  } catch (error) {
    console.error("❌ ERROR EN /obtener_usuario:", error);
    res.status(500).json({
      succes: false,
      message: "Error al obtener usuario",
    });
  }
});

router.post("/crear_usuario", verificarToken, soloAdmin, async (req, res) => {
  const { nombre, pin, contrasena, es_admin } = req.body;

  if (typeof nombre !== "string" || !nombre.trim() || !pin || typeof contrasena !== "string" || !contrasena) {
    return res.status(400).json({
      succes: false,
      message: "Todos los campos son obligatorios",
    });
  }

  if (nombre.trim().length > 50) {
    return res.status(400).json({
      succes: false,
      message: "El nombre no puede tener más de 50 caracteres",
    });
  }

  if (typeof pin !== "number" || !Number.isInteger(pin) || pin < 1000 || pin > 9999) {
    return res.status(400).json({
      succes: false,
      message: "El pin debe tener 4 digitos",
    });
  }

  if (!regexContrasena.test(contrasena)) {
    return res.status(400).json({
      succes: false,
      message: "La contraseña debe tener mínimo 8 caracteres, incluir una mayúscula, una minúscula, un número y un carácter especial (ej: Kevin12*)",
    });
  }

  try {
    const hashedPassword = await bcrypt.hash(contrasena, 10);
    const esAdmin = Number(es_admin) === 1 ? 1 : 0;

    await pool.execute("CALL crearUsuario(?,?,?,?)", [nombre.trim(), pin, hashedPassword, esAdmin]);

    res.json({
      succes: true,
      message: "Creacion de usuario correcto",
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        succes: false,
        message: "El nombre ya se encuentra registrado",
      });
    }

    console.error("❌ ERROR EN /crear_usuario:", error);
    res.status(500).json({
      succes: false,
      message: "Error al crear cuenta usuario",
    });
  }
});

// Pública: es la recuperación de contraseña con nombre + PIN
router.put("/actualizar_usuario", limiteIntentos, async (req, res) => {
  const { nombre, pin, nueva_contrasena } = req.body;

  if (typeof nombre !== "string" || !nombre || !pin || typeof nueva_contrasena !== "string" || !nueva_contrasena) {
    return res.status(400).json({
      succes: false,
      message: "Se requieren todos los campos",
    });
  }

  if (!regexContrasena.test(nueva_contrasena)) {
    return res.status(400).json({
      succes: false,
      message: "La nueva contraseña debe tener mínimo 8 caracteres, incluir una mayúscula, una minúscula, un número y un carácter especial (ej: Kevin12*)",
    });
  }

  try {
    const hashedNewPassword = await bcrypt.hash(nueva_contrasena, 10);

    await pool.execute("CALL actualizarUsuario(?,?,?)", [
      nombre,
      Number(pin),
      hashedNewPassword,
    ]);

    res.status(201).json({
      succes: true,
      message: "Actualizacion contrasena correcta",
    });
  } catch (error) {
    console.error("❌ ERROR EN /actualizar_usuario:", error);
    res.status(500).json({
      succes: false,
      message: "Error al actualizar contrasena",
    });
  }
});

router.delete("/eliminar_usuario/:id", verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;

  if (!esIdValido(id)) {
    return res.status(400).json({ succes: false, message: "ID inválido" });
  }

  if (Number(id) === Number(req.usuario.id)) {
    return res.status(400).json({
      succes: false,
      message: "No puede eliminar su propio usuario",
    });
  }

  try {
    await pool.execute("CALL eliminarUsuario(?)", [Number(id)]);

    res.status(200).json({
      succes: true,
      message: "Eliminacion de usuario correctamente",
    });
  } catch (error) {
    console.error("❌ ERROR EN /eliminar_usuario:", error);
    res.status(500).json({
      succes: false,
      message: "Error al eliminar usuario",
    });
  }
});

export default router;
