const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../db");

const router = express.Router();

router.post("/register", async (req, res) => {
  const { nombre, correo, telefono, password } = req.body;

  try {
    const existente = await new Promise((resolve, reject) => {
      db.get("SELECT * FROM usuarios WHERE correo = ?", [correo], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (existente) {
      return res.status(400).json({ error: "El correo ya está registrado" });
    }

    const hashed = await bcrypt.hash(password, 10);

    // Insertar usuario
    const result = await new Promise((resolve, reject) => {
      db.run(
        "INSERT INTO usuarios (nombre, correo, telefono, password) VALUES (?, ?, ?, ?)",
        [nombre, correo, telefono, hashed],
        function (err) {
          if (err) reject(err);
          else resolve({ id: this.lastID });
        }
      );
    });

    res.json({
      userId: result.id,
      nombre,
      correo
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar usuario" });
  }
});

router.post("/login", (req, res) => {
  const { correo, password } = req.body;
  db.get("SELECT * FROM usuarios WHERE correo = ?", [correo], async (err, user) => {
    if (err || !user) return res.status(400).json({ error: "Usuario no encontrado" });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: "Contraseña incorrecta" });
    res.json({ id: user.id, nombre: user.nombre });
  });
});


module.exports = router;
