const express = require("express");
const db = require("../db");

const router = express.Router();

// Crear nuevo comentario/reseña
router.post("/", (req, res) => {
  const { tienda_id, cliente_nombre, cliente_telefono, comentario, calificacion } = req.body;
  
  if (!comentario || comentario.trim().length < 5) {
    return res.status(400).json({ error: "El comentario debe tener al menos 5 caracteres" });
  }
  
  if (calificacion && (calificacion < 1 || calificacion > 5)) {
    return res.status(400).json({ error: "La calificación debe estar entre 1 y 5" });
  }
  
  db.run(
    "INSERT INTO comentarios (tienda_id, cliente_nombre, cliente_telefono, comentario, calificacion) VALUES (?, ?, ?, ?, ?)",
    [tienda_id, cliente_nombre, cliente_telefono || null, comentario.trim(), calificacion || null],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      
      res.json({
        id: this.lastID,
        tienda_id,
        cliente_nombre,
        comentario: comentario.trim(),
        calificacion,
        message: "Comentario enviado correctamente. Será revisado antes de publicarse."
      });
    }
  );
});

// Obtener comentarios públicos aprobados de una tienda
router.get("/tienda/:tiendaId", (req, res) => {
  const { limite = 10, pagina = 1 } = req.query;
  const offset = (pagina - 1) * limite;
  
  const query = `
    SELECT 
      id,
      cliente_nombre,
      comentario,
      calificacion,
      created_at
    FROM comentarios 
    WHERE tienda_id = ? AND aprobado = 1 
    ORDER BY created_at DESC 
    LIMIT ? OFFSET ?
  `;
  
  db.all(query, [req.params.tiendaId, parseInt(limite), parseInt(offset)], (err, rows) => {
    if (err) return res.status(400).json({ error: err.message });
    
    // Obtener estadísticas de calificaciones
    db.get(
      `SELECT 
        AVG(CAST(calificacion AS FLOAT)) as promedio_calificacion,
        COUNT(*) as total_comentarios,
        COUNT(CASE WHEN calificacion IS NOT NULL THEN 1 END) as total_calificaciones
      FROM comentarios 
      WHERE tienda_id = ? AND aprobado = 1`,
      [req.params.tiendaId],
      (err, stats) => {
        if (err) return res.status(400).json({ error: err.message });
        
        res.json({
          comentarios: rows,
          estadisticas: {
            promedio_calificacion: stats.promedio_calificacion ? parseFloat(stats.promedio_calificacion).toFixed(1) : null,
            total_comentarios: stats.total_comentarios,
            total_calificaciones: stats.total_calificaciones
          }
        });
      }
    );
  });
});

// Obtener comentarios pendientes de aprobación (para el dueño)
router.get("/pendientes/:tiendaId", (req, res) => {
  db.all(
    "SELECT * FROM comentarios WHERE tienda_id = ? AND aprobado = 0 ORDER BY created_at DESC",
    [req.params.tiendaId],
    (err, rows) => {
      if (err) return res.status(400).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Aprobar comentario
router.put("/:comentarioId/aprobar", (req, res) => {
  db.run(
    "UPDATE comentarios SET aprobado = 1 WHERE id = ?",
    [req.params.comentarioId],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Comentario no encontrado" });
      
      res.json({ message: "Comentario aprobado correctamente" });
    }
  );
});

// Rechazar/eliminar comentario
router.delete("/:comentarioId", (req, res) => {
  db.run(
    "DELETE FROM comentarios WHERE id = ?",
    [req.params.comentarioId],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Comentario no encontrado" });
      
      res.json({ message: "Comentario eliminado correctamente" });
    }
  );
});

// Obtener estadísticas detalladas de comentarios
router.get("/stats/:tiendaId", (req, res) => {
  const queries = {
    // Distribución de calificaciones
    distribucion: `
      SELECT 
        calificacion,
        COUNT(*) as cantidad
      FROM comentarios 
      WHERE tienda_id = ? AND aprobado = 1 AND calificacion IS NOT NULL
      GROUP BY calificacion
      ORDER BY calificacion DESC
    `,
    // Comentarios recientes
    recientes: `
      SELECT 
        cliente_nombre,
        comentario,
        calificacion,
        created_at
      FROM comentarios 
      WHERE tienda_id = ? AND aprobado = 1 
      ORDER BY created_at DESC 
      LIMIT 5
    `,
    // Resumen general
    resumen: `
      SELECT 
        AVG(CAST(calificacion AS FLOAT)) as promedio,
        COUNT(*) as total_comentarios,
        COUNT(CASE WHEN aprobado = 0 THEN 1 END) as pendientes,
        COUNT(CASE WHEN calificacion = 5 THEN 1 END) as cinco_estrellas,
        COUNT(CASE WHEN calificacion >= 4 THEN 1 END) as cuatro_mas_estrellas
      FROM comentarios 
      WHERE tienda_id = ?
    `
  };
  
  const stats = {};
  
  // Obtener distribución
  db.all(queries.distribucion, [req.params.tiendaId], (err, distribucion) => {
    if (err) return res.status(400).json({ error: err.message });
    stats.distribucion = distribucion;
    
    // Obtener comentarios recientes
    db.all(queries.recientes, [req.params.tiendaId], (err, recientes) => {
      if (err) return res.status(400).json({ error: err.message });
      stats.recientes = recientes;
      
      // Obtener resumen
      db.get(queries.resumen, [req.params.tiendaId], (err, resumen) => {
        if (err) return res.status(400).json({ error: err.message });
        
        stats.resumen = {
          promedio_calificacion: resumen.promedio ? parseFloat(resumen.promedio).toFixed(1) : 0,
          total_comentarios: resumen.total_comentarios || 0,
          pendientes_aprobacion: resumen.pendientes || 0,
          cinco_estrellas: resumen.cinco_estrellas || 0,
          cuatro_mas_estrellas: resumen.cuatro_mas_estrellas || 0,
          porcentaje_satisfaccion: resumen.total_comentarios > 0 
            ? ((resumen.cuatro_mas_estrellas / resumen.total_comentarios) * 100).toFixed(1)
            : 0
        };
        
        res.json(stats);
      });
    });
  });
});

module.exports = router;