import express from "express";
import connectDb from "../db.js";

const router = express.Router();


//Ingreso de usuario 

router.post("/entrada_usuario",async (req,res)=>{
  const {nombre,contrasena} = req.body

if(!nombre||!contrasena) {
  return res.status(400).json({
    succes:false, 
    message:"Todos los campos son requeridos para el ingreso"
  })
}
try {
  
const db = await connectDb();
const [rows] = await db.execute("CALL entradaUsuario(?,?)",[nombre,contrasena])

if(rows[0].length ===0){
  return res.status(401).json({
    succes:false,
    message:"Usuario o contrasena incorrecta"
  })
}

res.status(200).json({
  succes:true,
  message:"Ingreso correcto",
  usuario:rows[0][0]
})

} catch (error) {
  res.status(500).json({
    succes:false,
    message:"Erro al iniciar sesion",
    error:error.message
  })
}

})


//Obtener Usuario
router.get("/obtener_usuario", async (req, res) => {
  try {
    const db = await connectDb();
    const [rows] = await db.execute("CALL obtenerUsuarios()");
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({
      succes: false,
      message: "Error al obetner ususario",
      error: error.message,
    });
  }
});

//Crear  Usuario

router.post("/crear_usuario", async (req, res) => {
  const { nombre, pin,contrasena,es_admin  } = req.body;

  if (!nombre ||!pin  ||!contrasena ) {
    return res.status(400).json({
      succes: false,
      message: "Todos los campos son obligatorios",
    });
  }

  if (typeof pin !== "number" || pin < 1000  || pin > 9999) {
    return res.status(400).json({
      succes: false,
      message: " pin debe tener 4 digitos",
    });
  }
  try {
    const db = await connectDb();
    await db.execute("CALL crearUsuario(?,?,?,?)", [nombre, pin, contrasena,es_admin]);
    res.json({
      succes: true,
      message: "Creacion de ususario correcto",
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
      message: "Error al crear ceunta ususario",
      error: error.message,
    });
  }
});

//Actualizar contrasena

router.put("/actualizar_ususario", async (req, res) => {
  const { nombre, pin, nueva_contrasena } = req.body;
  if (!nombre || !pin || !nueva_contrasena) {
    return res.status(400).json({
      succes: false,
      message: "Se requiere todo los campos",
    });
  }

  try {
    const db = await connectDb();

    const [validar] = await db.execute("CALL actualizarUsuario(?,?,?)", [
      nombre,
      pin,
      nueva_contrasena,
    ]);

    res.status(201).json({
      succes: true,
      message: "Actualizacion contrasena correcta",
    });
  } catch (error) {
    res.status(500).json({
      succes: false,
      message: "Error al actualiar contradena",
      error: error.message,
    });
  }
});

//Eliminar ususario

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
      message: "Error al eliminar ususario",
      error: error.message,
    });
  }
});
export default router;