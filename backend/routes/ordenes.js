// routes/ordenes.js - Con integración Socket.IO
const express = require("express");
const db = require("../db");

const router = express.Router();

// Generar número de orden único
function generarNumeroOrden() {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `ORD-${timestamp.slice(-6)}-${random}`;
}

// Crear nueva orden con notificación en tiempo real
router.post("/", (req, res) => {
  const {
    tienda_id,
    cliente_nombre,
    cliente_telefono,
    cliente_direccion,
    items,
    notas,
    metodo_pago
  } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: "La orden debe tener al menos un producto" });
  }

  const numero_orden = generarNumeroOrden();
  const total = items.reduce((sum, item) => sum + (item.precio_unitario * item.cantidad), 0);

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    
    // Crear orden
    db.run(
      `INSERT INTO ordenes (numero_orden, tienda_id, cliente_nombre, cliente_telefono, 
       cliente_direccion, total, notas, metodo_pago) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [numero_orden, tienda_id, cliente_nombre, cliente_telefono, 
       cliente_direccion, total, notas, metodo_pago || 'efectivo'],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res.status(400).json({ error: err.message });
        }

        const orden_id = this.lastID;
        
        // Insertar items de la orden
        const itemsPromises = items.map(item => {
          return new Promise((resolve, reject) => {
            const subtotal = item.precio_unitario * item.cantidad;
            db.run(
              `INSERT INTO orden_items (orden_id, producto_id, variante_id, cantidad, 
               precio_unitario, subtotal, notas) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [orden_id, item.producto_id, item.variante_id || null, item.cantidad, 
               item.precio_unitario, subtotal, item.notas || null],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        });

        Promise.all(itemsPromises)
          .then(() => {
            db.run("COMMIT");
            
            // Obtener datos completos de la orden para la notificación
            const ordenCompleta = {
              id: orden_id,
              numero_orden,
              tienda_id,
              cliente_nombre,
              cliente_telefono,
              cliente_direccion,
              total,
              estado: 'pendiente',
              items: items.map(item => ({
                ...item,
                subtotal: item.precio_unitario * item.cantidad
              })),
              created_at: new Date().toISOString(),
              notas,
              metodo_pago: metodo_pago || 'efectivo'
            };

            // 🔥 EMITIR NOTIFICACIÓN EN TIEMPO REAL A LA TIENDA
            if (global.socketEmit) {
              global.socketEmit.toTiendaAdmin(tienda_id, 'nueva-orden', {
                orden: ordenCompleta,
                timestamp: new Date().toISOString(),
                tipo: 'nueva_orden'
              });
              
              console.log(`📱 Notificación enviada a tienda ${tienda_id} - Nueva orden: ${numero_orden}`);
            }
            
            // Obtener datos de la tienda para WhatsApp
            db.get("SELECT nombre, whatsapp FROM tiendas WHERE id = ?", [tienda_id], (err, tienda) => {
              if (err) return res.status(400).json({ error: err.message });
              
              res.json({
                orden_id,
                numero_orden,
                total,
                estado: 'pendiente',
                whatsapp_url: generarURLWhatsApp(tienda, ordenCompleta),
                success: true,
                message: 'Orden creada correctamente'
              });
            });
          })
          .catch((err) => {
            db.run("ROLLBACK");
            res.status(400).json({ error: err.message });
          });
      }
    );
  });
});

// Actualizar estado de orden con notificación en tiempo real
router.put("/:ordenId/estado", (req, res) => {
  const { estado } = req.body;
  const estadosValidos = ['pendiente', 'confirmada', 'preparando', 'enviada', 'entregada', 'cancelada'];
  
  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({ error: "Estado no válido" });
  }
  
  // Primero obtener la orden actual
  db.get(
    "SELECT * FROM ordenes WHERE id = ?",
    [req.params.ordenId],
    (err, ordenActual) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!ordenActual) return res.status(404).json({ error: "Orden no encontrada" });
      
      // Actualizar el estado
      db.run(
        "UPDATE ordenes SET estado = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [estado, req.params.ordenId],
        function (err) {
          if (err) return res.status(400).json({ error: err.message });
        
          // 🔥 EMITIR ACTUALIZACIÓN EN TIEMPO REAL
          if (global.socketEmit) {
            global.socketEmit.toTienda(ordenActual.tienda_id, 'orden-actualizada', {
              ordenId: req.params.ordenId,
              numeroOrden: ordenActual.numero_orden,
              estadoAnterior: ordenActual.estado,
              nuevoEstado: estado,
              clienteNombre: ordenActual.cliente_nombre,
              timestamp: new Date().toISOString(),
              tipo: 'cambio_estado'
            });
            
            console.log(`📱 Estado actualizado - Orden ${ordenActual.numero_orden}: ${ordenActual.estado} → ${estado}`);
          }
          
          res.json({ 
            message: "Estado actualizado correctamente",
            estado: estado,
            numero_orden: ordenActual.numero_orden,
            notificacion_enviada: true
          });
        }
      );
    }
  );
});

// Obtener órdenes por tienda con filtros mejorados
router.get("/tienda/:tiendaId", (req, res) => {
  const { estado, limite = 50, pagina = 1, tiempo } = req.query;
  const offset = (pagina - 1) * limite;
  
  let query = `
    SELECT o.*, COUNT(oi.id) as total_items,
           GROUP_CONCAT(p.nombre) as productos_nombres
    FROM ordenes o
    LEFT JOIN orden_items oi ON o.id = oi.orden_id
    LEFT JOIN productos p ON oi.producto_id = p.id
    WHERE o.tienda_id = ?
  `;
  const params = [req.params.tiendaId];
  
  if (estado) {
    query += " AND o.estado = ?";
    params.push(estado);
  }
  
  // Filtro por tiempo
  if (tiempo === 'hoy') {
    query += " AND DATE(o.created_at) = DATE('now')";
  } else if (tiempo === 'semana') {
    query += " AND o.created_at >= DATE('now', '-7 days')";
  } else if (tiempo === 'mes') {
    query += " AND o.created_at >= DATE('now', '-30 days')";
  }
  
  query += ` 
    GROUP BY o.id 
    ORDER BY o.created_at DESC 
    LIMIT ? OFFSET ?
  `;
  params.push(parseInt(limite), parseInt(offset));
  
  db.all(query, params, (err, rows) => {
    if (err) return res.status(400).json({ error: err.message });
    
    // Formatear los resultados
    const ordenes = rows.map(orden => ({
      ...orden,
      productos_nombres: orden.productos_nombres ? orden.productos_nombres.split(',') : []
    }));
    
    res.json(ordenes);
  });
});

// Obtener detalle completo de una orden
router.get("/:ordenId", (req, res) => {
  const query = `
    SELECT o.*, t.nombre as tienda_nombre, t.whatsapp
    FROM ordenes o
    JOIN tiendas t ON o.tienda_id = t.id
    WHERE o.id = ?
  `;
  
  db.get(query, [req.params.ordenId], (err, orden) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!orden) return res.status(404).json({ error: "Orden no encontrada" });
    
    // Obtener items de la orden con detalles de productos
    const itemsQuery = `
      SELECT 
        oi.*,
        p.nombre as producto_nombre,
        p.imagen_principal,
        v.nombre as variante_nombre
      FROM orden_items oi
      JOIN productos p ON oi.producto_id = p.id
      LEFT JOIN producto_variantes v ON oi.variante_id = v.id
      WHERE oi.orden_id = ?
      ORDER BY oi.id
    `;
    
    db.all(itemsQuery, [req.params.ordenId], (err, items) => {
      if (err) return res.status(400).json({ error: err.message });
      
      res.json({
        ...orden,
        items: items || []
      });
    });
  });
});

// Endpoint para notificaciones de prueba
router.post("/:ordenId/notificar", (req, res) => {
  const { tipo, mensaje } = req.body;
  
  db.get("SELECT * FROM ordenes WHERE id = ?", [req.params.ordenId], (err, orden) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!orden) return res.status(404).json({ error: "Orden no encontrada" });
    
    if (global.socketEmit) {
      global.socketEmit.toTienda(orden.tienda_id, 'notificacion-personalizada', {
        ordenId: req.params.ordenId,
        numeroOrden: orden.numero_orden,
        tipo: tipo || 'info',
        mensaje: mensaje || 'Notificación de prueba',
        timestamp: new Date().toISOString()
      });
      
      res.json({ 
        message: 'Notificación enviada correctamente',
        enviada_a: `tienda-${orden.tienda_id}`
      });
    } else {
      res.status(503).json({ error: 'Socket.IO no está disponible' });
    }
  });
});

// Obtener estadísticas en tiempo real
router.get("/stats/:tiendaId", (req, res) => {
  const queries = {
    total_ordenes: "SELECT COUNT(*) as count FROM ordenes WHERE tienda_id = ?",
    ordenes_pendientes: "SELECT COUNT(*) as count FROM ordenes WHERE tienda_id = ? AND estado = 'pendiente'",
    ordenes_hoy: "SELECT COUNT(*) as count FROM ordenes WHERE tienda_id = ? AND DATE(created_at) = DATE('now')",
    ventas_hoy: "SELECT COALESCE(SUM(total), 0) as total FROM ordenes WHERE tienda_id = ? AND DATE(created_at) = DATE('now') AND estado != 'cancelada'",
    ventas_mes: "SELECT COALESCE(SUM(total), 0) as total FROM ordenes WHERE tienda_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') AND estado != 'cancelada'",
    orden_promedio: "SELECT COALESCE(AVG(total), 0) as promedio FROM ordenes WHERE tienda_id = ? AND estado != 'cancelada'",
    producto_mas_vendido: `
      SELECT p.nombre, SUM(oi.cantidad) as cantidad_vendida
      FROM orden_items oi
      JOIN productos p ON oi.producto_id = p.id
      JOIN ordenes o ON oi.orden_id = o.id
      WHERE o.tienda_id = ? AND o.estado != 'cancelada'
      GROUP BY p.id, p.nombre
      ORDER BY cantidad_vendida DESC
      LIMIT 1
    `
  };
  
  const stats = {};
  const promises = Object.keys(queries).map(key => {
    return new Promise((resolve) => {
      db.get(queries[key], [req.params.tiendaId], (err, result) => {
        if (!err) {
          if (key === 'producto_mas_vendido') {
            stats[key] = result || { nombre: 'N/A', cantidad_vendida: 0 };
          } else {
            stats[key] = result?.count || result?.total || result?.promedio || 0;
          }
        }
        resolve();
      });
    });
  });
  
  Promise.all(promises).then(() => {
    // Agregar timestamp para el cliente
    stats.timestamp = new Date().toISOString();
    stats.tienda_id = req.params.tiendaId;
    
    res.json(stats);
  });
});

// Búsqueda mejorada con filtros
router.get("/buscar/:tiendaId", (req, res) => {
  const { q, estado, fecha_inicio, fecha_fin } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: "Parámetro de búsqueda requerido" });
  }
  
  let query = `
    SELECT o.*, COUNT(oi.id) as total_items
    FROM ordenes o
    LEFT JOIN orden_items oi ON o.id = oi.orden_id
    WHERE o.tienda_id = ? AND (
      o.numero_orden LIKE ? OR
      o.cliente_nombre LIKE ? OR
      o.cliente_telefono LIKE ?
    )
  `;
  
  const searchTerm = `%${q}%`;
  let params = [req.params.tiendaId, searchTerm, searchTerm, searchTerm];
  
  if (estado) {
    query += " AND o.estado = ?";
    params.push(estado);
  }
  
  if (fecha_inicio) {
    query += " AND DATE(o.created_at) >= DATE(?)";
    params.push(fecha_inicio);
  }
  
  if (fecha_fin) {
    query += " AND DATE(o.created_at) <= DATE(?)";
    params.push(fecha_fin);
  }
  
  query += ` 
    GROUP BY o.id 
    ORDER BY o.created_at DESC 
    LIMIT 50
  `;
  
  db.all(query, params, (err, rows) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json(rows);
  });
});

// Generar URL de WhatsApp mejorada
function generarURLWhatsApp(tienda, orden) {
  if (!tienda.whatsapp) return null;
  
  const estadoEmojis = {
    'pendiente': '⏳',
    'confirmada': '✅', 
    'preparando': '👨‍🍳',
    'enviada': '🚚',
    'entregada': '📦',
    'cancelada': '❌'
  };

  const mensaje = `
🛒 *${orden.estado === 'pendiente' ? 'Nueva Orden' : 'Actualización de Orden'}*
📄 *Número:* ${orden.numero_orden}
${estadoEmojis[orden.estado]} *Estado:* ${orden.estado.toUpperCase()}

👤 *Cliente:* ${orden.cliente_nombre}
📞 *Teléfono:* ${orden.cliente_telefono}
${orden.cliente_direccion ? `🏠 *Dirección:* ${orden.cliente_direccion}` : ''}

📦 *Productos:*
${orden.items.map(item => 
  `• ${item.producto_nombre || 'Producto'} ${item.variante_nombre ? `(${item.variante_nombre})` : ''} x${item.cantidad} - $${item.precio_unitario.toLocaleString()}`
).join('\n')}

💰 *Total: $${orden.total.toLocaleString()}*
🎯 *Método de pago:* ${orden.metodo_pago}

${orden.notas ? `📝 *Notas:* ${orden.notas}` : ''}

¡Gracias por tu pedido!
  `.trim();

  const encodedMessage = encodeURIComponent(mensaje);
  const whatsappNumber = tienda.whatsapp.replace(/\D/g, '');
  
  return `https://wa.me/${whatsappNumber}?text=${encodedMessage}`;
}

// Agregar este endpoint a tu archivo routes/ordenes.js

// Obtener orden por número de orden (para el cliente)
router.get("/numero/:numeroOrden", (req, res) => {
  const query = `
    SELECT o.*, t.nombre as tienda_nombre, t.whatsapp
    FROM ordenes o
    JOIN tiendas t ON o.tienda_id = t.id
    WHERE o.numero_orden = ?
  `;
  
  db.get(query, [req.params.numeroOrden], (err, orden) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!orden) return res.status(404).json({ error: "Orden no encontrada" });
    
    // Obtener items de la orden con detalles de productos
    const itemsQuery = `
      SELECT 
        oi.*,
        p.nombre as producto_nombre,
        p.imagen_principal,
        v.nombre as variante_nombre
      FROM orden_items oi
      JOIN productos p ON oi.producto_id = p.id
      LEFT JOIN producto_variantes v ON oi.variante_id = v.id
      WHERE oi.orden_id = ?
      ORDER BY oi.id
    `;
    
    db.all(itemsQuery, [orden.id], (err, items) => {
      if (err) return res.status(400).json({ error: err.message });
      
      res.json({
        ...orden,
        items: items || []
      });
    });
  });
});

// Endpoint para notificar específicamente al cliente de una orden
router.post("/:ordenId/notificar-cliente", (req, res) => {
  const { mensaje, tipo = 'info' } = req.body;
  
  db.get("SELECT * FROM ordenes WHERE id = ?", [req.params.ordenId], (err, orden) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!orden) return res.status(404).json({ error: "Orden no encontrada" });
    
    if (global.socketEmit && global.socketEmit.toTiendaClientes) {
      // Emitir solo a los clientes que siguen esta tienda
      global.socketEmit.toTiendaClientes(orden.tienda_id, 'notificacion-personalizada', {
        ordenId: req.params.ordenId,
        numeroOrden: orden.numero_orden,
        tipo: tipo,
        mensaje: mensaje || 'Notificación para tu pedido',
        timestamp: new Date().toISOString()
      });
      
      res.json({ 
        message: 'Notificación enviada al cliente correctamente',
        orden_numero: orden.numero_orden,
        cliente: orden.cliente_nombre,
        mensaje_enviado: mensaje
      });
    } else {
      res.status(503).json({ error: 'Socket.IO no está disponible' });
    }
  });
});

// Endpoint para obtener actualizaciones en tiempo real de una orden específica
router.get("/:numeroOrden/stream", (req, res) => {
  // Configurar SSE (Server-Sent Events) como alternativa a Socket.IO
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  const numeroOrden = req.params.numeroOrden;
  
  // Enviar configuración inicial
  res.write(`data: ${JSON.stringify({
    type: 'connected',
    message: `Conectado al seguimiento de ${numeroOrden}`,
    timestamp: new Date().toISOString()
  })}\n\n`);

  // Consultar orden para obtener tienda_id
  db.get("SELECT * FROM ordenes WHERE numero_orden = ?", [numeroOrden], (err, orden) => {
    if (err || !orden) {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        message: 'Orden no encontrada',
        timestamp: new Date().toISOString()
      })}\n\n`);
      res.end();
      return;
    }

    // Aquí puedes implementar un sistema de polling para verificar cambios
    const interval = setInterval(() => {
      // Verificar si la orden ha cambiado (esto es básico, podrías usar un sistema más sofisticado)
      db.get("SELECT * FROM ordenes WHERE numero_orden = ?", [numeroOrden], (err, ordenActual) => {
        if (!err && ordenActual) {
          res.write(`data: ${JSON.stringify({
            type: 'orden-update',
            orden: ordenActual,
            timestamp: new Date().toISOString()
          })}\n\n`);
        }
      });
    }, 10000); // Verificar cada 10 segundos

    // Limpiar cuando se cierra la conexión
    req.on('close', () => {
      clearInterval(interval);
    });
  });
});


module.exports = router;