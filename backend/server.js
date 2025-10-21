
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { createServer } = require("http");
const { Server } = require("socket.io");
const db = require("./db");


const usuariosRoutes = require("./routes/usuarios");
const tiendasRoutes = require("./routes/tiendas");
const productosRoutes = require("./routes/productos");
const ordenesRoutes = require("./routes/ordenes");
const comentariosRoutes = require("./routes/comentarios");
const configuracionRoutes = require("./routes/configuracion");

const app = express();
const server = createServer(app);
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: false,
  optionsSuccessStatus: 200
}));

// Headers adicionales para asegurar que las imágenes se carguen desde cualquier origen
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  res.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
  
  // Responder a OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;



app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Servir archivos estáticos con headers correctos para CORS
app.use(express.static("frontend", {
  setHeaders: (res, path) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  }
}));

app.use('/uploads', express.static('frontend/uploads', {
  setHeaders: (res, path) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', 'public, max-age=31536000');
  }
}));

// Rate limiting
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 100,
//   message: {
//     error: "Demasiadas solicitudes desde esta IP, intenta de nuevo más tarde."
//   }
// });

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: {
    error: "Demasiadas subidas de archivos, intenta de nuevo más tarde."
  }
});

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://link.com']
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static("frontend"));
app.use('/uploads', express.static('frontend/uploads'));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

const tiendaConnections = new Map();

io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  socket.on('join-tienda', (tiendaId) => {
    if (!tiendaId) return;

    socket.join(`tienda-${tiendaId}`);

    if (!tiendaConnections.has(tiendaId)) {
      tiendaConnections.set(tiendaId, new Set());
    }
    tiendaConnections.get(tiendaId).add(socket.id);

    console.log(`Socket ${socket.id} se unió a tienda-${tiendaId}`);

    socket.emit('connection-status', {
      status: 'connected',
      tiendaId: tiendaId,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('leave-tienda', (tiendaId) => {
    if (!tiendaId) return;

    socket.leave(`tienda-${tiendaId}`);

    if (tiendaConnections.has(tiendaId)) {
      tiendaConnections.get(tiendaId).delete(socket.id);
      if (tiendaConnections.get(tiendaId).size === 0) {
        tiendaConnections.delete(tiendaId);
      }
    }

    console.log(`Socket ${socket.id} salió de tienda-${tiendaId}`);
  });

  socket.on('update-config', (data) => {
    const { tiendaId, config } = data;

    io.to(`tienda-${tiendaId}`).emit('config-updated', {
      tiendaId,
      config,
      timestamp: new Date().toISOString()
    });

    console.log(`Configuración de tienda ${tiendaId} actualizada`);
  });

  socket.on('nuevo-evento', (data) => {
    const { tiendaId, evento } = data;

    io.to(`tienda-${tiendaId}`).emit('evento-created', {
      tiendaId,
      evento,
      timestamp: new Date().toISOString()
    });

    console.log(`Nuevo evento creado para tienda ${tiendaId}: ${evento.titulo}`);
  });

  socket.on('update-evento', (data) => {
    const { tiendaId, eventoId, cambios } = data;

    io.to(`tienda-${tiendaId}`).emit('evento-updated', {
      tiendaId,
      eventoId,
      cambios,
      timestamp: new Date().toISOString()
    });

    console.log(`Evento ${eventoId} actualizado para tienda ${tiendaId}`);
  });

  socket.on('codigo-usado', (data) => {
    const { tiendaId, codigoInfo } = data;

    io.to(`tienda-admin-${tiendaId}`).emit('codigo-discount-usado', {
      tiendaId,
      codigoInfo,
      timestamp: new Date().toISOString()
    });

    console.log(`Código de descuento usado en tienda ${tiendaId}`);
  });

  socket.on('update-orden-status', (data) => {
    const { tiendaId, ordenId, nuevoEstado, numeroOrden } = data;

    io.to(`tienda-${tiendaId}`).emit('orden-status-updated', {
      ordenId,
      numeroOrden,
      nuevoEstado,
      timestamp: new Date().toISOString()
    });

    console.log(`Estado de orden ${numeroOrden} actualizado a ${nuevoEstado}`);
  });

  socket.on('nueva-orden', (data) => {
    const { tiendaId, orden } = data;

    socket.to(`tienda-admin-${tiendaId}`).emit('nueva-orden-recibida', {
      orden,
      timestamp: new Date().toISOString()
    });

    console.log(`Nueva orden recibida para tienda ${tiendaId}: ${orden.numero_orden}`);
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);

    // Limpiar de todas las tiendas
    for (let [tiendaId, connections] of tiendaConnections) {
      connections.delete(socket.id);
      if (connections.size === 0) {
        tiendaConnections.delete(tiendaId);
      }
    }
  });


  socket.on('join-tienda-cliente', (tiendaId) => {
    const room = `tienda-${tiendaId}-clientes`;
    socket.join(room);
    console.log(`👤 Cliente ${socket.id} sigue tienda ${tiendaId}`);

    socket.emit('suscripcion-confirmada', {
      tiendaId: tiendaId,
      message: 'Suscrito a actualizaciones'
    });
  });

  socket.on('ping', () => {
    socket.emit('pong', { timestamp: new Date().toISOString() });
  });
});

function emitToTienda(tiendaId, event, data) {
  io.to(`tienda-${tiendaId}`).emit(event, data);
}

function emitToTiendaAdmin(tiendaId, event, data) {
  io.to(`tienda-admin-${tiendaId}`).emit(event, data);
}

global.socketEmit = {
  toTienda: emitToTienda,
  toTiendaAdmin: emitToTiendaAdmin
};


app.use("/api/usuarios", usuariosRoutes);
app.use("/api/tiendas", tiendasRoutes);
app.use("/api/productos", uploadLimiter, productosRoutes);
app.use("/api/ordenes", ordenesRoutes);
app.use("/api/comentarios", comentariosRoutes);
app.use("/api/configuracion", uploadLimiter, configuracionRoutes);

// Rutas para el frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/login.html"));
});

app.get("/tienda/:token", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/publica.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/admin.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/dashboard.html"));
});

app.get("/producto", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/new_pro.html"));
});

app.get("/ordenes", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/ordenes_new.html"));
});

app.get("/comentarios", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/comentarios_new_shoplink.html"));
});

app.get("/configuracion", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/confi.html"));
});
app.get("/configuracionAvance", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/configuracion.html"));
});

app.get("/eventos", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/eventos.html"));
});

app.get("/pedios", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/mispedidos.html"));
});

app.post("/api/whatsapp/generar", (req, res) => {
  const { numero, mensaje } = req.body;

  if (!numero || !mensaje) {
    return res.status(400).json({ error: "Número y mensaje son requeridos" });
  }

  const numeroLimpio = numero.replace(/\D/g, '');
  const mensajeCodificado = encodeURIComponent(mensaje);
  const url = `https://wa.me/${numeroLimpio}?text=${mensajeCodificado}`;

  res.json({ url });
});

app.get("/api/socket/stats", (req, res) => {
  const stats = {
    total_connections: io.engine.clientsCount,
    tiendas_activas: tiendaConnections.size,
    connections_por_tienda: {}
  };

  for (let [tiendaId, connections] of tiendaConnections) {
    stats.connections_por_tienda[tiendaId] = connections.size;
  }

  res.json(stats);
});

app.get("/api/tienda/:token/config", (req, res) => {
  const { token } = req.params;

  const query = `
    SELECT 
      tc.*,
      t.nombre as tienda_nombre,
      t.descripcion as tienda_descripcion,
      t.whatsapp,
      t.direccion,
      t.horarios
    FROM tienda_configuracion tc
    LEFT JOIN tiendas t ON tc.tienda_id = t.id
    WHERE t.token = ? AND t.activa = 1
  `;


  db.get(query, [token], (err, row) => {
    if (err) {
      console.error('Error al obtener configuración pública:', err);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Tienda no encontrada' });
    }

    const configPublica = {
      tienda_nombre: row.tienda_nombre,
      tienda_descripcion: row.tienda_descripcion,
      logo_url: row.logo_url,
      banner_url: row.banner_url,
      eslogan: row.eslogan,
      color_primario: row.color_primario,
      color_secundario: row.color_secundario,
      color_acento: row.color_acento,
      color_fondo: row.color_fondo,
      mostrar_busqueda: row.mostrar_busqueda,
      mostrar_filtros: row.mostrar_filtros,
      mostrar_categorias: row.mostrar_categorias,
      mostrar_comentarios: row.mostrar_comentarios,
      mostrar_whatsapp: row.mostrar_whatsapp,
      mensaje_bienvenida: row.mensaje_bienvenida,
      mensaje_pie_pagina: row.mensaje_pie_pagina,
      tiempo_preparacion_min: row.tiempo_preparacion_min,
      delivery_disponible: row.delivery_disponible,
      pickup_disponible: row.pickup_disponible,
      pedido_minimo: row.pedido_minimo,
      costo_delivery: row.costo_delivery,
      zona_delivery: row.zona_delivery,
      estilo_layout: row.estilo_layout,
      mostrar_precios: row.mostrar_precios,
      mostrar_imagenes_productos: row.mostrar_imagenes_productos,
      whatsapp: row.whatsapp,
      direccion: row.direccion,
      horarios: row.horarios
    };

    res.json(configPublica);

  });
});

app.use((error, req, res, next) => {
  console.error('Error:', error);

  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'El archivo es demasiado grande. Máximo 5MB.' });
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Demasiados archivos o campo inesperado.' });
  }

  if (error.message.includes('Solo se permiten imágenes')) {
    return res.status(400).json({ error: error.message });
  }

  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : error.message
  });
});

app.use("*", (req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  io.close(() => {
    console.log('Socket.IO server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  io.close(() => {
    console.log('Socket.IO server closed');
    process.exit(0);
  });
});


// setInterval(() => {
//   http.get("https://shoplink-bn90.onrender.com"); // cambia por tu URL
// }, 5 * 60 * 1000);


server.listen(PORT, () => {
  console.log(` Servidor ejecutándose en http://localhost:${PORT}`);
  console.log(` Socket.IO habilitado`);
  console.log(` Archivos estáticos: ${path.join(__dirname, "../frontend")}`);
  console.log(` Uploads: ${path.join(__dirname, "../frontend/uploads")}`);

  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n Rutas disponibles:`);
    console.log(`   • Home: http://localhost:${PORT}`);
    console.log(`   • Admin: http://localhost:${PORT}/admin`);
    console.log(`   • Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`   • Configuración: http://localhost:${PORT}/configuracion`);
    console.log(`   • Eventos: http://localhost:${PORT}/eventos`);
    console.log(`   • API: http://localhost:${PORT}/api/*`);
    console.log(`   • Socket Stats: http://localhost:${PORT}/api/socket/stats`);
  }
});

module.exports = app;