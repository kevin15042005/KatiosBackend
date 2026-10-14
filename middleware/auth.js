import jwt from "jsonwebtoken";

// Verifica que la petición traiga un token válido: "Authorization: Bearer <token>"
export const verificarToken = (req, res, next) => {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ succes: false, message: "Debe iniciar sesión" });
  }

  try {
    req.usuario = jwt.verify(header.slice(7), process.env.JWT_SECRETO);
    next();
  } catch {
    return res.status(401).json({ succes: false, message: "Sesión inválida o expirada" });
  }
};

// Solo deja pasar a administradores (usar después de verificarToken)
export const soloAdmin = (req, res, next) => {
  if (Number(req.usuario?.es_admin) !== 1) {
    return res.status(403).json({ succes: false, message: "Acceso denegado" });
  }
  next();
};
