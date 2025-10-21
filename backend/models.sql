-- Tabla usuarios
CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    correo TEXT UNIQUE NOT NULL,
    telefono TEXT,
    password TEXT NOT NULL,
    avatar TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabla tiendas
CREATE TABLE IF NOT EXISTS tiendas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    categoria TEXT,
    whatsapp TEXT,
    direccion TEXT,
    horarios TEXT,
    owner_id INTEGER NOT NULL UNIQUE,
    qr_code TEXT,
    token TEXT UNIQUE,
    activa INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(owner_id) REFERENCES usuarios(id)
);

-- Tabla categorías de productos
CREATE TABLE IF NOT EXISTS categorias_productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    tienda_id INTEGER NOT NULL,
    orden INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(tienda_id) REFERENCES tiendas(id)
);

-- Tabla productos mejorada
CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    precio_base REAL NOT NULL,
    imagen_principal TEXT,
    categoria_id INTEGER,
    tienda_id INTEGER NOT NULL,
    disponible INTEGER DEFAULT 1,
    orden INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(tienda_id) REFERENCES tiendas(id),
    FOREIGN KEY(categoria_id) REFERENCES categorias_productos(id)
);

-- Tabla variantes de productos
CREATE TABLE IF NOT EXISTS producto_variantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER NOT NULL,
    nombre TEXT NOT NULL, -- "Mediana", "Grande", "Extra cheese", etc.
    precio REAL NOT NULL, -- precio de esta variante
    disponible INTEGER DEFAULT 1,
    orden INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(producto_id) REFERENCES productos(id)
);

-- Tabla imágenes de productos
CREATE TABLE IF NOT EXISTS producto_imagenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER NOT NULL,
    url_imagen TEXT NOT NULL,
    alt_text TEXT,
    orden INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(producto_id) REFERENCES productos(id)
);

-- Tabla órdenes
CREATE TABLE IF NOT EXISTS ordenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_orden TEXT UNIQUE NOT NULL,
    tienda_id INTEGER NOT NULL,
    cliente_nombre TEXT NOT NULL,
    cliente_telefono TEXT NOT NULL,
    cliente_direccion TEXT,
    total REAL NOT NULL,
    estado TEXT DEFAULT 'pendiente', -- pendiente, confirmada, preparando, enviada, entregada, cancelada
    notas TEXT,
    metodo_pago TEXT DEFAULT 'efectivo',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(tienda_id) REFERENCES tiendas(id)
);

-- Tabla items de órdenes
CREATE TABLE IF NOT EXISTS orden_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orden_id INTEGER NOT NULL,
    producto_id INTEGER NOT NULL,
    variante_id INTEGER,
    cantidad INTEGER NOT NULL,
    precio_unitario REAL NOT NULL,
    subtotal REAL NOT NULL,
    notas TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(orden_id) REFERENCES ordenes(id),
    FOREIGN KEY(producto_id) REFERENCES productos(id),
    FOREIGN KEY(variante_id) REFERENCES producto_variantes(id)
);

-- Tabla comentarios/reseñas
CREATE TABLE IF NOT EXISTS comentarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tienda_id INTEGER NOT NULL,
    cliente_nombre TEXT NOT NULL,
    cliente_telefono TEXT,
    comentario TEXT NOT NULL,
    calificacion INTEGER CHECK(calificacion >= 1 AND calificacion <= 5),
    aprobado INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(tienda_id) REFERENCES tiendas(id)
);


-- Tabla configuración de tienda
CREATE TABLE IF NOT EXISTS tienda_configuracion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tienda_id INTEGER NOT NULL UNIQUE,
    
    -- Información de la empresa
    razon_social TEXT,
    logo_url TEXT,
    banner_url TEXT,
    eslogan TEXT,
    
    -- Colores de la tienda (máximo 4)
    color_primario TEXT, -- #hexadecimal
    color_secundario TEXT,
    color_acento TEXT,
    color_fondo TEXT,
    
    -- Configuraciones de visualización
    mostrar_busqueda INTEGER DEFAULT 1,
    mostrar_filtros INTEGER DEFAULT 1,
    mostrar_categorias INTEGER DEFAULT 1,
    mostrar_comentarios INTEGER DEFAULT 1,
    mostrar_whatsapp INTEGER DEFAULT 1,
    
    -- Configuraciones adicionales
    mensaje_bienvenida TEXT,
    mensaje_pie_pagina TEXT,
    tiempo_preparacion_min INTEGER DEFAULT 30, -- minutos estimados
    delivery_disponible INTEGER DEFAULT 1,
    pickup_disponible INTEGER DEFAULT 1,
    
    -- Configuración de pedidos
    pedido_minimo REAL DEFAULT 0,
    costo_delivery REAL DEFAULT 0,
    zona_delivery TEXT, -- descripción de zona de entrega
    
    -- Redes sociales
    facebook_url TEXT,
    instagram_url TEXT,
    tiktok_url TEXT,
    
    -- Configuración de tema
    estilo_layout TEXT DEFAULT 'moderno', -- moderno, clasico, minimalista
    mostrar_precios INTEGER DEFAULT 1,
    mostrar_imagenes_productos INTEGER DEFAULT 1,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY(tienda_id) REFERENCES tiendas(id) ON DELETE CASCADE
);

-- Tabla eventos/promociones
CREATE TABLE IF NOT EXISTS eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tienda_id INTEGER NOT NULL,
    
    -- Información del evento
    titulo TEXT NOT NULL,
    descripcion TEXT,
    imagen_principal TEXT,
    
    -- Tipo de evento
    tipo TEXT DEFAULT 'promocion', -- promocion, descuento, evento_especial, nuevo_producto
    
    -- Fechas del evento
    fecha_inicio DATE,
    fecha_fin DATE,
    hora_inicio TIME,
    hora_fin TIME,
    
    -- Configuración de descuento (si aplica)
    descuento_porcentaje REAL,
    descuento_monto REAL,
    productos_aplicables TEXT, -- JSON con IDs de productos, null = todos
    codigo_descuento TEXT,
    
    -- Configuración de visualización
    mostrar_en_banner INTEGER DEFAULT 1,
    mostrar_en_inicio INTEGER DEFAULT 1,
    color_destacado TEXT, -- color especial para este evento
    
    -- Estado y prioridad
    activo INTEGER DEFAULT 1,
    prioridad INTEGER DEFAULT 0, -- mayor número = mayor prioridad
    
    -- Límites del evento
    limite_uso INTEGER, -- cuántas veces se puede usar
    usos_actuales INTEGER DEFAULT 0,
    limite_por_cliente INTEGER DEFAULT 1,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY(tienda_id) REFERENCES tiendas(id) ON DELETE CASCADE
);

-- Tabla imágenes de eventos (para múltiples imágenes por evento)
CREATE TABLE IF NOT EXISTS evento_imagenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evento_id INTEGER NOT NULL,
    url_imagen TEXT NOT NULL,
    alt_text TEXT,
    orden INTEGER DEFAULT 0,
    tipo TEXT DEFAULT 'galeria', -- principal, galeria, banner
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY(evento_id) REFERENCES eventos(id) ON DELETE CASCADE
);

-- Tabla para tracking de uso de códigos de descuento
CREATE TABLE IF NOT EXISTS evento_usos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evento_id INTEGER NOT NULL,
    orden_id INTEGER,
    cliente_telefono TEXT,
    codigo_usado TEXT,
    descuento_aplicado REAL,
    usado_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY(evento_id) REFERENCES eventos(id),
    FOREIGN KEY(orden_id) REFERENCES ordenes(id)
);

-- Índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_config_tienda ON tienda_configuracion(tienda_id);
CREATE INDEX IF NOT EXISTS idx_eventos_tienda ON eventos(tienda_id);
CREATE INDEX IF NOT EXISTS idx_eventos_activos ON eventos(activo, fecha_inicio, fecha_fin);
CREATE INDEX IF NOT EXISTS idx_evento_imagenes ON evento_imagenes(evento_id);
CREATE INDEX IF NOT EXISTS idx_evento_usos ON evento_usos(evento_id, cliente_telefono);

-- Trigger para actualizar updated_at automáticamente
CREATE TRIGGER IF NOT EXISTS update_config_timestamp 
    AFTER UPDATE ON tienda_configuracion
    FOR EACH ROW
    BEGIN
        UPDATE tienda_configuracion SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

CREATE TRIGGER IF NOT EXISTS update_eventos_timestamp 
    AFTER UPDATE ON eventos
    FOR EACH ROW
    BEGIN
        UPDATE eventos SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- Índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_productos_tienda ON productos(tienda_id);
CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_variantes_producto ON producto_variantes(producto_id);
CREATE INDEX IF NOT EXISTS idx_imagenes_producto ON producto_imagenes(producto_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_tienda ON ordenes(tienda_id);
CREATE INDEX IF NOT EXISTS idx_orden_items_orden ON orden_items(orden_id);
CREATE INDEX IF NOT EXISTS idx_comentarios_tienda ON comentarios(tienda_id);