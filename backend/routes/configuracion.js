// routes/configuracion.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const db = require("../db");
const router = express.Router();

// Configuración de multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../frontend/uploads/configuracion');
    
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|svg/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (JPEG, JPG, PNG, GIF, WebP, SVG)'));
    }
  }
});

// Función para eliminar archivo físico
function deleteImageFile(imageUrl) {
  if (!imageUrl) return;
  
  try {
    const imagePath = path.join(__dirname, '../../frontend', imageUrl);
    
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
      console.log('Imagen eliminada:', imagePath);
    }
  } catch (error) {
    console.error('Error al eliminar imagen:', error);
  }
}

// Función para obtener configuración
function getConfiguracion(tiendaId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM tienda_configuracion WHERE tienda_id = ?',
      [tiendaId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

// GET - Obtener configuración de tienda
router.get('/tienda/:tiendaId', (req, res) => {
  const { tiendaId } = req.params;

  const query = `
    SELECT 
      tc.*,
      t.nombre as tienda_nombre,
      t.descripcion as tienda_descripcion
    FROM tienda_configuracion tc
    LEFT JOIN tiendas t ON tc.tienda_id = t.id
    WHERE tc.tienda_id = ?
  `;

  db.get(query, [tiendaId], (err, row) => {
    if (err) {
      console.error('Error al obtener configuración:', err);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }

    if (!row) {
      const defaultConfig = {
        tienda_id: tiendaId,
        color_primario: '#007bff',
        color_secundario: '#6c757d', 
        color_acento: '#28a745',
        color_fondo: '#ffffff',
        estilo_layout: 'moderno',
        mostrar_busqueda: 1,
        mostrar_filtros: 1,
        mostrar_categorias: 1,
        mostrar_comentarios: 1,
        mostrar_whatsapp: 1,
        mostrar_precios: 1,
        mostrar_imagenes_productos: 1,
        tiempo_preparacion_min: 30,
        delivery_disponible: 1,
        pickup_disponible: 1,
        pedido_minimo: 0,
        costo_delivery: 0
      };

      const insertQuery = `
        INSERT INTO tienda_configuracion (
          tienda_id, color_primario, color_secundario, color_acento, color_fondo,
          estilo_layout, mostrar_busqueda, mostrar_filtros, mostrar_categorias,
          mostrar_comentarios, mostrar_whatsapp, mostrar_precios, mostrar_imagenes_productos,
          tiempo_preparacion_min, delivery_disponible, pickup_disponible, pedido_minimo, costo_delivery
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const values = [
        defaultConfig.tienda_id, defaultConfig.color_primario, defaultConfig.color_secundario,
        defaultConfig.color_acento, defaultConfig.color_fondo, defaultConfig.estilo_layout,
        defaultConfig.mostrar_busqueda, defaultConfig.mostrar_filtros, defaultConfig.mostrar_categorias,
        defaultConfig.mostrar_comentarios, defaultConfig.mostrar_whatsapp, defaultConfig.mostrar_precios,
        defaultConfig.mostrar_imagenes_productos, defaultConfig.tiempo_preparacion_min,
        defaultConfig.delivery_disponible, defaultConfig.pickup_disponible, defaultConfig.pedido_minimo,
        defaultConfig.costo_delivery
      ];

      db.run(insertQuery, values, function(err) {
        if (err) {
          console.error('Error al crear configuración por defecto:', err);
          return res.status(500).json({ error: 'Error interno del servidor' });
        }

        res.json({ ...defaultConfig, id: this.lastID });
      });
    } else {
      res.json(row);
    }
  });
});

// PUT - Actualizar configuración (CON ELIMINACIÓN DE IMÁGENES ANTIGUAS)
router.put('/tienda/:tiendaId', upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'banner', maxCount: 1 }
]), async (req, res) => {
  const { tiendaId } = req.params;
  const data = req.body;

  try {
    // Obtener configuración actual
    const configActual = await getConfiguracion(tiendaId);

    // Procesar archivos y eliminar antiguos
    if (req.files) {
      if (req.files.logo) {
        // Eliminar logo antiguo
        if (configActual && configActual.logo_url) {
          deleteImageFile(configActual.logo_url);
        }
        data.logo_url = `/uploads/configuracion/${req.files.logo[0].filename}`;
      }
      
      if (req.files.banner) {
        // Eliminar banner antiguo
        if (configActual && configActual.banner_url) {
          deleteImageFile(configActual.banner_url);
        }
        data.banner_url = `/uploads/configuracion/${req.files.banner[0].filename}`;
      }
    }

    // Construir query
    const campos = [];
    const valores = [];
    
    const camposPermitidos = [
      'razon_social', 'logo_url', 'banner_url', 'eslogan',
      'color_primario', 'color_secundario', 'color_acento', 'color_fondo',
      'mostrar_busqueda', 'mostrar_filtros', 'mostrar_categorias', 'mostrar_comentarios', 'mostrar_whatsapp',
      'mensaje_bienvenida', 'mensaje_pie_pagina', 'tiempo_preparacion_min',
      'delivery_disponible', 'pickup_disponible', 'pedido_minimo', 'costo_delivery', 'zona_delivery',
      'facebook_url', 'instagram_url', 'tiktok_url',
      'estilo_layout', 'mostrar_precios', 'mostrar_imagenes_productos'
    ];

    camposPermitidos.forEach(campo => {
      if (data[campo] !== undefined) {
        campos.push(`${campo} = ?`);
        valores.push(data[campo]);
      }
    });

    if (campos.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    campos.push('updated_at = CURRENT_TIMESTAMP');
    valores.push(tiendaId);

    const query = `UPDATE tienda_configuracion SET ${campos.join(', ')} WHERE tienda_id = ?`;

    db.run(query, valores, function(err) {
      if (err) {
        console.error('Error al actualizar configuración:', err);
        return res.status(500).json({ error: 'Error interno del servidor' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Configuración no encontrada' });
      }

      if (global.socketEmit) {
        global.socketEmit.toTienda(tiendaId, 'config-updated', {
          tiendaId,
          campos: campos.filter(c => c !== 'updated_at = CURRENT_TIMESTAMP'),
          timestamp: new Date().toISOString()
        });
      }

      res.json({ 
        success: true, 
        message: 'Configuración actualizada correctamente',
        changes: this.changes,
        logo_url: data.logo_url,
        banner_url: data.banner_url
      });
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al actualizar configuración' });
  }
});

// DELETE - Eliminar logo
router.delete('/tienda/:tiendaId/logo', async (req, res) => {
  const { tiendaId } = req.params;

  try {
    const config = await getConfiguracion(tiendaId);
    
    if (!config || !config.logo_url) {
      return res.status(404).json({ error: 'No hay logo para eliminar' });
    }

    // Eliminar archivo físico
    deleteImageFile(config.logo_url);

    // Actualizar base de datos
    db.run(
      'UPDATE tienda_configuracion SET logo_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE tienda_id = ?',
      [tiendaId],
      function(err) {
        if (err) {
          console.error('Error al eliminar logo:', err);
          return res.status(500).json({ error: 'Error al eliminar logo' });
        }

        res.json({ 
          success: true, 
          message: 'Logo eliminado correctamente' 
        });
      }
    );
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al eliminar logo' });
  }
});

// DELETE - Eliminar banner
router.delete('/tienda/:tiendaId/banner', async (req, res) => {
  const { tiendaId } = req.params;

  try {
    const config = await getConfiguracion(tiendaId);
    
    if (!config || !config.banner_url) {
      return res.status(404).json({ error: 'No hay banner para eliminar' });
    }

    // Eliminar archivo físico
    deleteImageFile(config.banner_url);

    // Actualizar base de datos
    db.run(
      'UPDATE tienda_configuracion SET banner_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE tienda_id = ?',
      [tiendaId],
      function(err) {
        if (err) {
          console.error('Error al eliminar banner:', err);
          return res.status(500).json({ error: 'Error al eliminar banner' });
        }

        res.json({ 
          success: true, 
          message: 'Banner eliminado correctamente' 
        });
      }
    );
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al eliminar banner' });
  }
});

// Manejo de errores
router.use((error, req, res, next) => {
  console.error('Error en configuración routes:', error);
  
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'El archivo es demasiado grande. Máximo 5MB.' });
  }
  
  if (error.message.includes('Solo se permiten imágenes')) {
    return res.status(400).json({ error: error.message });
  }
  
  res.status(500).json({ error: 'Error interno del servidor' });
});



// ====== EVENTOS Y PROMOCIONES ======

// GET - Obtener eventos de una tienda
router.get('/eventos/:tiendaId', (req, res) => {
  const { tiendaId } = req.params;
  const { activos, tipo, limit } = req.query;

  let query = `
    SELECT 
      e.*,
      (SELECT COUNT(*) FROM evento_imagenes ei WHERE ei.evento_id = e.id) as total_imagenes
    FROM eventos e
    WHERE e.tienda_id = ?
  `;
  
  const params = [tiendaId];

  // Filtros opcionales
  if (activos === '1') {
    query += ` AND e.activo = 1 AND (e.fecha_fin IS NULL OR e.fecha_fin >= date('now'))`;
  }

  if (tipo) {
    query += ` AND e.tipo = ?`;
    params.push(tipo);
  }

  query += ` ORDER BY e.prioridad DESC, e.created_at DESC`;

  if (limit) {
    query += ` LIMIT ?`;
    params.push(parseInt(limit));
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error al obtener eventos:', err);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }

    res.json(rows || []);
  });
});

// GET - Obtener evento específico con imágenes
router.get('/evento/:eventoId', (req, res) => {
  const { eventoId } = req.params;

  const query = `
    SELECT 
      e.*,
      t.nombre as tienda_nombre
    FROM eventos e
    LEFT JOIN tiendas t ON e.tienda_id = t.id
    WHERE e.id = ?
  `;

  db.get(query, [eventoId], (err, evento) => {
    if (err) {
      console.error('Error al obtener evento:', err);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }

    if (!evento) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    // Obtener imágenes del evento
    const imagenesQuery = `
      SELECT * FROM evento_imagenes 
      WHERE evento_id = ? 
      ORDER BY orden ASC, created_at ASC
    `;

    db.all(imagenesQuery, [eventoId], (err, imagenes) => {
      if (err) {
        console.error('Error al obtener imágenes del evento:', err);
        return res.status(500).json({ error: 'Error interno del servidor' });
      }

      evento.imagenes = imagenes || [];
      res.json(evento);
    });
  });
});

// POST - Crear nuevo evento
router.post('/evento', upload.fields([
  { name: 'imagen_principal', maxCount: 1 },
  { name: 'imagenes_galeria', maxCount: 10 }
]), (req, res) => {
  const data = req.body;

  // Procesar imagen principal
  if (req.files && req.files.imagen_principal) {
    data.imagen_principal = `/uploads/configuracion/${req.files.imagen_principal[0].filename}`;
  }

  // Validaciones básicas
  if (!data.tienda_id || !data.titulo) {
    return res.status(400).json({ error: 'tienda_id y titulo son requeridos' });
  }

  const query = `
    INSERT INTO eventos (
      tienda_id, titulo, descripcion, imagen_principal, tipo,
      fecha_inicio, fecha_fin, hora_inicio, hora_fin,
      descuento_porcentaje, descuento_monto, productos_aplicables, codigo_descuento,
      mostrar_en_banner, mostrar_en_inicio, color_destacado,
      activo, prioridad, limite_uso, limite_por_cliente
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const valores = [
    data.tienda_id, data.titulo, data.descripcion, data.imagen_principal, data.tipo || 'promocion',
    data.fecha_inicio, data.fecha_fin, data.hora_inicio, data.hora_fin,
    data.descuento_porcentaje, data.descuento_monto, data.productos_aplicables, data.codigo_descuento,
    data.mostrar_en_banner || 1, data.mostrar_en_inicio || 1, data.color_destacado,
    data.activo || 1, data.prioridad || 0, data.limite_uso, data.limite_por_cliente || 1
  ];

  db.run(query, valores, function(err) {
    if (err) {
      console.error('Error al crear evento:', err);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }

    const eventoId = this.lastID;

    // Procesar imágenes de galería si existen
    if (req.files && req.files.imagenes_galeria) {
      const imagenesPromises = req.files.imagenes_galeria.map((file, index) => {
        return new Promise((resolve, reject) => {
          const insertImageQuery = `
            INSERT INTO evento_imagenes (evento_id, url_imagen, orden, tipo)
            VALUES (?, ?, ?, 'galeria')
          `;
          
          db.run(insertImageQuery, [
            eventoId, 
            `/uploads/configuracion/${file.filename}`, 
            index
          ], function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
          });
        });
      });

      Promise.all(imagenesPromises)
        .then(() => {
          // Emitir evento via Socket.IO
          if (global.socketEmit) {
            global.socketEmit.toTienda(data.tienda_id, 'nuevo-evento', {
              eventoId,
              titulo: data.titulo,
              tipo: data.tipo || 'promocion',
              timestamp: new Date().toISOString()
            });
          }

          res.status(201).json({ 
            success: true, 
            id: eventoId, 
            message: 'Evento creado correctamente' 
          });
        })
        .catch(err => {
          console.error('Error al guardar imágenes:', err);
          res.status(201).json({ 
            success: true, 
            id: eventoId, 
            message: 'Evento creado, pero error al guardar algunas imágenes',
            warning: true
          });
        });
    } else {
      // Emitir evento via Socket.IO
      if (global.socketEmit) {
        global.socketEmit.toTienda(data.tienda_id, 'nuevo-evento', {
          eventoId,
          titulo: data.titulo,
          tipo: data.tipo || 'promocion',
          timestamp: new Date().toISOString()
        });
      }

      res.status(201).json({ 
        success: true, 
        id: eventoId, 
        message: 'Evento creado correctamente' 
      });
    }
  });
});

// PUT - Actualizar evento
router.put('/evento/:eventoId', upload.fields([
  { name: 'imagen_principal', maxCount: 1 },
  { name: 'imagenes_galeria', maxCount: 10 }
]), (req, res) => {
  const { eventoId } = req.params;
  const data = req.body;

  // Procesar imagen principal si se subió
  if (req.files && req.files.imagen_principal) {
    data.imagen_principal = `/uploads/configuracion/${req.files.imagen_principal[0].filename}`;
  }

  // Construir query dinámicamente
  const campos = [];
  const valores = [];
  
  const camposPermitidos = [
    'titulo', 'descripcion', 'imagen_principal', 'tipo',
    'fecha_inicio', 'fecha_fin', 'hora_inicio', 'hora_fin',
    'descuento_porcentaje', 'descuento_monto', 'productos_aplicables', 'codigo_descuento',
    'mostrar_en_banner', 'mostrar_en_inicio', 'color_destacado',
    'activo', 'prioridad', 'limite_uso', 'limite_por_cliente'
  ];

  camposPermitidos.forEach(campo => {
    if (data[campo] !== undefined) {
      campos.push(`${campo} = ?`);
      valores.push(data[campo]);
    }
  });

  if (campos.length === 0) {
    return res.status(400).json({ error: 'No hay campos para actualizar' });
  }

  campos.push('updated_at = CURRENT_TIMESTAMP');
  valores.push(eventoId);

  const query = `UPDATE eventos SET ${campos.join(', ')} WHERE id = ?`;

  db.run(query, valores, function(err) {
    if (err) {
      console.error('Error al actualizar evento:', err);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    // Obtener tienda_id para el socket
    db.get('SELECT tienda_id FROM eventos WHERE id = ?', [eventoId], (err, row) => {
      if (!err && row && global.socketEmit) {
        global.socketEmit.toTienda(row.tienda_id, 'evento-actualizado', {
          eventoId,
          campos: campos.filter(c => c !== 'updated_at = CURRENT_TIMESTAMP'),
          timestamp: new Date().toISOString()
        });
      }
    });

    res.json({ 
      success: true, 
      message: 'Evento actualizado correctamente',
      changes: this.changes 
    });
  });
});

// DELETE - Eliminar evento
router.delete('/evento/:eventoId', (req, res) => {
  const { eventoId } = req.params;

  // Primero obtener info del evento para el socket
  db.get('SELECT tienda_id, titulo FROM eventos WHERE id = ?', [eventoId], (err, evento) => {
    if (err) {
      console.error('Error al obtener evento:', err);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }

    if (!evento) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    // Eliminar evento (las imágenes y usos se eliminan por CASCADE)
    db.run('DELETE FROM eventos WHERE id = ?', [eventoId], function(err) {
      if (err) {
        console.error('Error al eliminar evento:', err);
        return res.status(500).json({ error: 'Error interno del servidor' });
      }

      // Emitir evento via Socket.IO
      if (global.socketEmit) {
        global.socketEmit.toTienda(evento.tienda_id, 'evento-eliminado', {
          eventoId,
          titulo: evento.titulo,
          timestamp: new Date().toISOString()
        });
      }

      res.json({ 
        success: true, 
        message: 'Evento eliminado correctamente' 
      });
    });
  });
});

// POST - Validar código de descuento
router.post('/validar-codigo', (req, res) => {
  const { codigo, tienda_id, cliente_telefono } = req.body;

  if (!codigo || !tienda_id) {
    return res.status(400).json({ error: 'Código y tienda_id son requeridos' });
  }

  const query = `
    SELECT 
      e.*,
      COALESCE(e.usos_actuales, 0) as usos_actuales,
      CASE 
        WHEN cliente_telefono IS NOT NULL THEN (
          SELECT COUNT(*) FROM evento_usos eu 
          WHERE eu.evento_id = e.id AND eu.cliente_telefono = ?
        )
        ELSE 0
      END as usos_cliente
    FROM eventos e
    WHERE e.codigo_descuento = ? 
      AND e.tienda_id = ? 
      AND e.activo = 1
      AND (e.fecha_fin IS NULL OR e.fecha_fin >= date('now'))
      AND (e.fecha_inicio IS NULL OR e.fecha_inicio <= date('now'))
  `;

  db.get(query, [cliente_telefono, codigo, tienda_id], (err, evento) => {
    if (err) {
      console.error('Error al validar código:', err);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }

    if (!evento) {
      return res.status(404).json({ 
        valid: false, 
        error: 'Código no válido o expirado' 
      });
    }

    // Verificar límites
    if (evento.limite_uso && evento.usos_actuales >= evento.limite_uso) {
      return res.status(400).json({ 
        valid: false, 
        error: 'Código agotado' 
      });
    }

    if (cliente_telefono && evento.limite_por_cliente && evento.usos_cliente >= evento.limite_por_cliente) {
      return res.status(400).json({ 
        valid: false, 
        error: 'Ya has usado este código el máximo de veces permitidas' 
      });
    }

    res.json({
      valid: true,
      evento: {
        id: evento.id,
        titulo: evento.titulo,
        descuento_porcentaje: evento.descuento_porcentaje,
        descuento_monto: evento.descuento_monto,
        productos_aplicables: evento.productos_aplicables
      }
    });
  });
});

// POST - Usar código de descuento
router.post('/usar-codigo', (req, res) => {
  const { evento_id, orden_id, cliente_telefono, codigo_usado, descuento_aplicado } = req.body;

  if (!evento_id || !codigo_usado || !descuento_aplicado) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  // Insertar uso del código
  const insertUsoQuery = `
    INSERT INTO evento_usos (evento_id, orden_id, cliente_telefono, codigo_usado, descuento_aplicado)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.run(insertUsoQuery, [evento_id, orden_id, cliente_telefono, codigo_usado, descuento_aplicado], function(err) {
    if (err) {
      console.error('Error al registrar uso del código:', err);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }

    // Actualizar contador de usos del evento
    db.run('UPDATE eventos SET usos_actuales = usos_actuales + 1 WHERE id = ?', [evento_id], (err) => {
      if (err) {
        console.error('Error al actualizar contador:', err);
      }
    });

    res.json({ 
      success: true, 
      message: 'Código aplicado correctamente' 
    });
  });
});

// Manejo de errores
router.use((error, req, res, next) => {
  console.error('Error en configuración routes:', error);
  
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'El archivo es demasiado grande. Máximo 5MB.' });
  }
  
  if (error.message.includes('Solo se permiten imágenes')) {
    return res.status(400).json({ error: error.message });
  }
  
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = router;