const express = require("express");
const db = require("../db");
const crypto = require("crypto");

const router = express.Router();

// Crear tienda (solo 1 por usuario)
router.post("/", (req, res) => {
  const { userId, nombre, descripcion, categoria, whatsapp, direccion, horarios } = req.body;
  const token = crypto.randomBytes(16).toString("hex");

  // Validar que userId esté presente
  if (!userId) {
    return res.status(400).json({ error: "El ID de usuario es requerido" });
  }

  // Validar número de WhatsApp
  if (whatsapp && !/^\+?[\d\s\-\(\)]+$/.test(whatsapp)) {
    return res.status(400).json({ error: "Formato de WhatsApp inválido" });
  }

  db.run(
    "INSERT INTO tiendas (owner_id, nombre, descripcion, categoria, whatsapp, direccion, horarios, token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [userId, nombre, descripcion, categoria, whatsapp, direccion, horarios, token],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: "Ya tienes una tienda registrada" });
        }
        return res.status(400).json({ error: err.message });
      }

      const tiendaId = this.lastID;
      const urlPublica = `/api/tiendas/publica/${tiendaId}?token=${token}`;

      res.json({
        id: tiendaId,
        nombre,
        descripcion,
        categoria,
        whatsapp,
        direccion,
        horarios,
        url: urlPublica,
        qr: `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(
          "http://localhost:3000" + urlPublica
        )}&size=200x200`,
        token
      });
    }
  );
});

// Obtener tienda por usuario (para el dueño/admin)
router.get("/por-usuario/:userId", (req, res) => {
  const query = `
    SELECT t.*, 
      COUNT(DISTINCT p.id) as total_productos,
      COUNT(DISTINCT o.id) as total_ordenes,
      COALESCE(AVG(CAST(c.calificacion AS FLOAT)), 0) as promedio_calificacion
    FROM tiendas t
    LEFT JOIN productos p ON t.id = p.tienda_id AND p.disponible = 1
    LEFT JOIN ordenes o ON t.id = o.tienda_id
    LEFT JOIN comentarios c ON t.id = c.tienda_id AND c.aprobado = 1 AND c.calificacion IS NOT NULL
    WHERE t.owner_id = ?
    GROUP BY t.id
  `;
  
  db.get(query, [req.params.userId], (err, row) => {
    if (err || !row) return res.status(404).json({ error: "Tienda no encontrada" });
    
    row.promedio_calificacion = row.promedio_calificacion ? parseFloat(row.promedio_calificacion).toFixed(1) : null;
    res.json(row);
  });
});

// Ver tienda pública (por token) - CORREGIDO
router.get("/publica/:token", (req, res) => {
  const { token } = req.params;

  // Obtener información de la tienda por token
  const tiendaQuery = `
    SELECT t.*, 
      COALESCE(AVG(CAST(c.calificacion AS FLOAT)), 0) as promedio_calificacion,
      COUNT(DISTINCT c.id) as total_comentarios
    FROM tiendas t
    LEFT JOIN comentarios c 
      ON t.id = c.tienda_id AND c.aprobado = 1 AND c.calificacion IS NOT NULL
    WHERE t.token = ? AND t.activa = 1
    GROUP BY t.id
  `;

  db.get(tiendaQuery, [token], (err, tienda) => {
    if (err) return res.status(500).json({ error: "Error en el servidor" });
    if (!tienda) return res.status(404).json({ error: "Tienda no encontrada o acceso no autorizado" });

    // Obtener productos organizados por categorías (MÉTODO CORREGIDO)
    const productosQuery = `
      SELECT 
        p.*,
        c.nombre as categoria_nombre,
        c.orden as categoria_orden
      FROM productos p
      LEFT JOIN categorias_productos c ON p.categoria_id = c.id
      WHERE p.tienda_id = ? AND p.disponible = 1
      ORDER BY c.orden, c.nombre, p.orden, p.nombre
    `;

    db.all(productosQuery, [tienda.id], (err, productos) => {
      if (err) return res.status(500).json({ error: err.message });

      if (productos.length === 0) {
        // Si no hay productos, devolver respuesta básica
        return res.json({
          tienda: {
            ...tienda,
            promedio_calificacion: tienda.promedio_calificacion 
              ? parseFloat(tienda.promedio_calificacion).toFixed(1) 
              : null
          },
          categorias: [],
          productos_sin_categoria: [],
          comentarios_recientes: []
        });
      }

      // Obtener variantes para todos los productos
      const productosIds = productos.map(p => p.id);
      const variantesQuery = `
        SELECT * FROM producto_variantes 
        WHERE producto_id IN (${productosIds.map(() => '?').join(',')}) AND disponible = 1
        ORDER BY orden, nombre
      `;

      db.all(variantesQuery, productosIds, (err, variantes) => {
        if (err) return res.status(500).json({ error: err.message });

        // Agrupar variantes por producto
        const variantesPorProducto = {};
        variantes.forEach(variante => {
          if (!variantesPorProducto[variante.producto_id]) {
            variantesPorProducto[variante.producto_id] = [];
          }
          variantesPorProducto[variante.producto_id].push(variante);
        });

        // Procesar productos con variantes
        const productosConVariantes = productos.map(producto => ({
          ...producto,
          variantes: variantesPorProducto[producto.id] || []
        }));

        // Agrupar productos por categoría
        const categorias = {};
        const productosSinCategoria = [];

        productosConVariantes.forEach(producto => {
          if (producto.categoria_id && producto.categoria_nombre) {
            if (!categorias[producto.categoria_id]) {
              categorias[producto.categoria_id] = {
                id: producto.categoria_id,
                nombre: producto.categoria_nombre,
                orden: producto.categoria_orden || 0,
                productos: []
              };
            }
            categorias[producto.categoria_id].productos.push(producto);
          } else {
            productosSinCategoria.push(producto);
          }
        });

        const categoriasArray = Object.values(categorias).sort((a, b) => a.orden - b.orden);

        // Obtener comentarios recientes
        db.all(
          `SELECT cliente_nombre, comentario, calificacion, created_at 
           FROM comentarios 
           WHERE tienda_id = ? AND aprobado = 1 
           ORDER BY created_at DESC 
           LIMIT 10`,
          [tienda.id],
          (err, comentarios) => {
            if (err) return res.status(500).json({ error: err.message });

            res.json({
              tienda: {
                ...tienda,
                promedio_calificacion: tienda.promedio_calificacion 
                  ? parseFloat(tienda.promedio_calificacion).toFixed(1) 
                  : null
              },
              categorias: categoriasArray,
              productos_sin_categoria: productosSinCategoria,
              comentarios_recientes: comentarios || []
            });
          }
        );
      });
    });
  });
});

// Actualizar información de tienda
router.put("/:tiendaId", (req, res) => {
  const { nombre, descripcion, categoria, whatsapp, direccion, horarios, activa } = req.body;
  
  // Validar número de WhatsApp si se proporciona
  if (whatsapp && !/^\+?[\d\s\-\(\)]+$/.test(whatsapp)) {
    return res.status(400).json({ error: "Formato de WhatsApp inválido" });
  }

  db.run(
    `UPDATE tiendas SET nombre = ?, descripcion = ?, categoria = ?, whatsapp = ?, 
     direccion = ?, horarios = ?, activa = ? WHERE id = ?`,
    [nombre, descripcion, categoria, whatsapp, direccion, horarios, activa !== undefined ? activa : 1, req.params.tiendaId],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Tienda no encontrada" });
      
      res.json({ message: "Tienda actualizada correctamente" });
    }
  );
});

// Obtener dashboard de estadísticas de la tienda
router.get("/:tiendaId/dashboard", (req, res) => {
  const queries = {
    // Estadísticas básicas
    basicas: `
      SELECT 
        (SELECT COUNT(*) FROM productos WHERE tienda_id = ? AND disponible = 1) as total_productos,
        (SELECT COUNT(*) FROM ordenes WHERE tienda_id = ?) as total_ordenes,
        (SELECT COUNT(*) FROM ordenes WHERE tienda_id = ? AND DATE(created_at) = DATE('now')) as ordenes_hoy,
        (SELECT COALESCE(SUM(total), 0) FROM ordenes WHERE tienda_id = ? AND estado != 'cancelada') as ventas_totales,
        (SELECT COALESCE(SUM(total), 0) FROM ordenes WHERE tienda_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') AND estado != 'cancelada') as ventas_mes
    `,
    
    // Órdenes recientes
    ordenes_recientes: `
      SELECT numero_orden, cliente_nombre, total, estado, created_at
      FROM ordenes 
      WHERE tienda_id = ? 
      ORDER BY created_at DESC 
      LIMIT 5
    `,
    
    // Productos más vendidos
    productos_top: `
      SELECT p.nombre, SUM(oi.cantidad) as cantidad_vendida, SUM(oi.subtotal) as ingresos
      FROM orden_items oi
      JOIN productos p ON oi.producto_id = p.id
      JOIN ordenes o ON oi.orden_id = o.id
      WHERE o.tienda_id = ? AND o.estado != 'cancelada'
      GROUP BY p.id, p.nombre
      ORDER BY cantidad_vendida DESC
      LIMIT 5
    `,
    
    // Estadísticas de comentarios
    comentarios_stats: `
      SELECT 
        COUNT(*) as total_comentarios,
        COUNT(CASE WHEN aprobado = 0 THEN 1 END) as pendientes,
        COALESCE(AVG(CAST(calificacion AS FLOAT)), 0) as promedio_calificacion
      FROM comentarios 
      WHERE tienda_id = ?
    `
  };

  const tiendaId = req.params.tiendaId;
  const dashboard = {};

  // Ejecutar consultas
  db.get(queries.basicas, [tiendaId, tiendaId, tiendaId, tiendaId, tiendaId], (err, basicas) => {
    if (err) return res.status(400).json({ error: err.message });
    dashboard.estadisticas = basicas;

    db.all(queries.ordenes_recientes, [tiendaId], (err, ordenes) => {
      if (err) return res.status(400).json({ error: err.message });
      dashboard.ordenes_recientes = ordenes;

      db.all(queries.productos_top, [tiendaId], (err, productos) => {
        if (err) return res.status(400).json({ error: err.message });
        dashboard.productos_top = productos;

        db.get(queries.comentarios_stats, [tiendaId], (err, comentarios) => {
          if (err) return res.status(400).json({ error: err.message });
          
          dashboard.comentarios = {
            ...comentarios,
            promedio_calificacion: comentarios.promedio_calificacion ? parseFloat(comentarios.promedio_calificacion).toFixed(1) : '0.0'
          };

          res.json(dashboard);
        });
      });
    });
  });
});

// Buscar tiendas públicas (para directorio)
router.get("/directorio/buscar", (req, res) => {
  const { q, categoria, limite = 20 } = req.query;
  
  let query = `
    SELECT 
      t.id, t.nombre, t.descripcion, t.categoria,
      COALESCE(AVG(CAST(c.calificacion AS FLOAT)), 0) as promedio_calificacion,
      COUNT(DISTINCT c.id) as total_comentarios,
      COUNT(DISTINCT p.id) as total_productos
    FROM tiendas t
    LEFT JOIN comentarios c ON t.id = c.tienda_id AND c.aprobado = 1 AND c.calificacion IS NOT NULL
    LEFT JOIN productos p ON t.id = p.tienda_id AND p.disponible = 1
    WHERE t.activa = 1
  `;
  
  const params = [];
  
  if (q) {
    query += " AND (t.nombre LIKE ? OR t.descripcion LIKE ?)";
    params.push(`%${q}%`, `%${q}%`);
  }
  
  if (categoria) {
    query += " AND t.categoria = ?";
    params.push(categoria);
  }
  
  query += ` 
    GROUP BY t.id 
    ORDER BY promedio_calificacion DESC, total_comentarios DESC 
    LIMIT ?
  `;
  params.push(parseInt(limite));
  
  db.all(query, params, (err, rows) => {
    if (err) return res.status(400).json({ error: err.message });
    
    const tiendas = rows.map(row => ({
      ...row,
      promedio_calificacion: row.promedio_calificacion ? parseFloat(row.promedio_calificacion).toFixed(1) : null
    }));
    
    res.json(tiendas);
  });
});





// ============================================
// ENDPOINT PARA INDEX/CATÁLOGO DE TIENDAS
// ============================================

// Obtener todas las tiendas activas para el índice público
router.get("/", (req, res) => {
  const { categoria, orden = 'recientes', limite = 50, pagina = 1 } = req.query;
  
  const offset = (parseInt(pagina) - 1) * parseInt(limite);
  
  let ordenSQL = '';
  switch(orden) {
    case 'mejores':
      ordenSQL = 'promedio_calificacion DESC, total_comentarios DESC';
      break;
    case 'populares':
      ordenSQL = 'total_productos DESC, total_comentarios DESC';
      break;
    case 'alfabetico':
      ordenSQL = 't.nombre ASC';
      break;
    case 'recientes':
    default:
      ordenSQL = 't.created_at DESC';
      break;
  }
  
  let query = `
    SELECT 
      t.id,
      t.nombre,
      t.descripcion,
      t.categoria,
      t.token,
      t.created_at,
      COALESCE(AVG(CAST(c.calificacion AS FLOAT)), 0) as promedio_calificacion,
      COUNT(DISTINCT c.id) as total_comentarios,
      COUNT(DISTINCT p.id) as total_productos
    FROM tiendas t
    LEFT JOIN comentarios c ON t.id = c.tienda_id AND c.aprobado = 1 AND c.calificacion IS NOT NULL
    LEFT JOIN productos p ON t.id = p.tienda_id AND p.disponible = 1
    WHERE t.activa = 1
  `;
  
  const params = [];
  
  if (categoria) {
    query += " AND t.categoria = ?";
    params.push(categoria);
  }
  
  query += ` 
    GROUP BY t.id 
    ORDER BY ${ordenSQL}
    LIMIT ? OFFSET ?
  `;
  
  params.push(parseInt(limite), offset);
  
  // Obtener total de tiendas para paginación
  let countQuery = "SELECT COUNT(*) as total FROM tiendas WHERE activa = 1";
  const countParams = [];
  
  if (categoria) {
    countQuery += " AND categoria = ?";
    countParams.push(categoria);
  }
  
  db.get(countQuery, countParams, (err, countResult) => {
    if (err) return res.status(500).json({ error: err.message });
    
    db.all(query, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      
      const tiendas = rows.map(row => ({
        id: row.id,
        nombre: row.nombre,
        descripcion: row.descripcion,
        categoria: row.categoria,
        token: row.token,
        url_publica: `/tienda/${row.token}`,
        promedio_calificacion: row.promedio_calificacion ? parseFloat(row.promedio_calificacion).toFixed(1) : '0.0',
        total_comentarios: row.total_comentarios || 0,
        total_productos: row.total_productos || 0,
        created_at: row.created_at
      }));
      
      res.json({
        tiendas,
        paginacion: {
          pagina_actual: parseInt(pagina),
          total_tiendas: countResult.total,
          total_paginas: Math.ceil(countResult.total / parseInt(limite)),
          tiendas_por_pagina: parseInt(limite)
        }
      });
    });
  });
});

// Obtener estadísticas generales del index
router.get("/estadisticas/generales", (req, res) => {
  const query = `
    SELECT 
      COUNT(DISTINCT t.id) as total_tiendas,
      COUNT(DISTINCT p.id) as total_productos,
      COUNT(DISTINCT o.id) as total_ordenes,
      COUNT(DISTINCT t.categoria) as total_categorias
    FROM tiendas t
    LEFT JOIN productos p ON t.id = p.tienda_id AND p.disponible = 1
    LEFT JOIN ordenes o ON t.id = o.tienda_id
    WHERE t.activa = 1
  `;
  
  db.get(query, [], (err, stats) => {
    if (err) return res.status(500).json({ error: err.message });
    
    // Obtener categorías con conteo
    db.all(
      `SELECT categoria, COUNT(*) as cantidad 
       FROM tiendas 
       WHERE activa = 1 AND categoria IS NOT NULL 
       GROUP BY categoria 
       ORDER BY cantidad DESC`,
      [],
      (err, categorias) => {
        if (err) return res.status(500).json({ error: err.message });
        
        res.json({
          estadisticas: stats,
          categorias: categorias
        });
      }
    );
  });
});



module.exports = router;