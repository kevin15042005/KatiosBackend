import express from "express";
import connectDb from "../db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const router = express.Router();

const regexContrasena = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;

router.post("/entrada_usuario", async (req, res) => {
  const { nombre, contrasena } = req.body;

  if (!nombre || !contrasena) {
    return res.status(400).json({
      succes: false, 
      message: "Todos los campos son requeridos para el ingreso"
    });
  }

  try {
    const db = await connectDb();
    const [rows] = await db.execute("CALL entradaUsuario(?)", [nombre]);

    if (rows[0].length === 0) {
      return res.status(401).json({
        succes: false,
        message: "Usuario o contraseña incorrecta"
      });
    }

    const usuario = rows[0][0];
    
    // Validación flexible: intenta comparar con bcrypt, y si falla o es texto plano, comprueba texto plano
    let passwordMatch = false;
    try {
      passwordMatch = await bcrypt.compare(contrasena, usuario.contrasena);
    } catch (e) {
      passwordMatch = false;
    }

    if (!passwordMatch && contrasena === usuario.contrasena) {
      passwordMatch = true;
    }

    if (!passwordMatch) {
      return res.status(400).json({
        succes: false,
        message: "Usuario o contraseña incorrecta"
      });
    }

    const payload = {
      id: usuario.id,
      nombre: usuario.nombre_usuario,
      es_admin: usuario.es_admin
    };

    const token = jwt.sign(payload, process.env.JWT_SECRETO || 'clave_secreta_temporal', {
      expiresIn: '4h'
    });

    return res.status(200).json({
      succes: true,
      message: "Ingreso correcto",
      token: token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre_usuario,
        es_admin: usuario.es_admin
      }
    });

  } catch (error) {
    return res.status(500).json({
      succes: false,
      message: "Error al iniciar sesion",
      error: error.message
    });
  }
});

router.get("/obtener_usuario", async (req, res) => {
  try {
    const db = await connectDb();
    const [rows] = await db.execute("CALL obtenerUsuarios()");
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({
      succes: false,
      message: "Error al obtener usuario",
      error: error.message,
    });
  }
});

router.post("/crear_usuario", async (req, res) => {
  const { nombre, pin, contrasena, es_admin } = req.body;

  if (!nombre || !pin || !contrasena) {
    return res.status(400).json({
      succes: false,
      message: "Todos los campos son obligatorios",
    });
  }

  if (typeof pin !== "number" || pin < 1000 || pin > 9999) {
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
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(contrasena, saltRounds);

    const db = await connectDb();
    await db.execute("CALL crearUsuario(?,?,?,?)", [nombre, pin, hashedPassword, es_admin]);
    
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

    res.status(500).json({
      succes: false,
      message: "Error al crear cuenta usuario",
      error: error.message,
    });
  }
});
router.put("/actualizar_usuario", async (req, res) => {
  const { nombre, pin, nueva_contrasena } = req.body;
  if (!nombre || !pin || !nueva_contrasena) {
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
    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(nueva_contrasena, saltRounds);

    const db = await connectDb();
    await db.execute("CALL actualizarUsuario(?,?,?)", [
      nombre,
      pin,
      hashedNewPassword,
    ]);

    res.status(201).json({
      succes: true,
      message: "Actualizacion contrasena correcta",
    });
  } catch (error) {
    res.status(500).json({
      succes: false,
      message: "Error al actualizar contrasena",
      error: error.message,
    });
  }
});

router.delete("/eliminar_usuario/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const db = await connectDb();
    await db.execute("CALL eliminarUsuario(?)", [parseInt(id)]);

    res.status(201).json({
      succes: true,
      message: "Eliminacion de usuario correctamente",
    });
  } catch (error) {
    res.status(500).json({
      succes: false,
      message: "Error al eliminar usuario",
      error: error.message,
    });
  }
});

export default router;