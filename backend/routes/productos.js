const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("../db");

const router = express.Router();

// Configuración de multer para subida de imágenes
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './frontend/uploads/productos';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (JPEG, PNG, GIF, WebP)'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB máximo
  }
});

// ==================== CATEGORÍAS ====================

// Crear categoría
router.post("/categorias", (req, res) => {
  const { tienda_id, nombre, descripcion, orden } = req.body;

  db.run(
    "INSERT INTO categorias_productos (tienda_id, nombre, descripcion, orden) VALUES (?, ?, ?, ?)",
    [tienda_id, nombre, descripcion, orden || 0],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({
        id: this.lastID,
        tienda_id,
        nombre,
        descripcion,
        orden: orden || 0
      });
    }
  );
});

// Obtener categorías por tienda
router.get("/categorias/:tiendaId", (req, res) => {
  db.all(
    "SELECT * FROM categorias_productos WHERE tienda_id = ? ORDER BY orden, nombre",
    [req.params.tiendaId],
    (err, rows) => {
      if (err) return res.status(400).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Actualizar categoría
router.put("/categorias/:categoriaId", (req, res) => {
  const { nombre, descripcion, orden } = req.body;

  db.run(
    "UPDATE categorias_productos SET nombre = ?, descripcion = ?, orden = ? WHERE id = ?",
    [nombre, descripcion, orden || 0, req.params.categoriaId],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Categoría no encontrada" });
      res.json({ message: "Categoría actualizada correctamente" });
    }
  );
});

// Eliminar categoría
router.delete("/categorias/:categoriaId", (req, res) => {
  db.run(
    "DELETE FROM categorias_productos WHERE id = ?",
    [req.params.categoriaId],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Categoría no encontrada" });
      res.json({ message: "Categoría eliminada correctamente" });
    }
  );
});

// ==================== PRODUCTOS ====================

// Crear producto con imagen principal
router.post("/", upload.single('imagen_principal'), (req, res) => {
  const { tienda_id, categoria_id, nombre, descripcion, precio_base, orden } = req.body;
  const imagen_principal = req.file ? `/uploads/productos/${req.file.filename}` : null;

  db.run(
    "INSERT INTO productos (tienda_id, categoria_id, nombre, descripcion, precio_base, imagen_principal, orden) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [tienda_id, categoria_id || null, nombre, descripcion, precio_base, imagen_principal, orden || 0],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });

      const productoId = this.lastID;

      // Obtener el producto completo creado
      db.get(
        `SELECT p.*, c.nombre as categoria_nombre 
         FROM productos p 
         LEFT JOIN categorias_productos c ON p.categoria_id = c.id 
         WHERE p.id = ?`,
        [productoId],
        (err, producto) => {
          if (err) return res.status(400).json({ error: err.message });
          res.json(producto);
        }
      );
    }
  );
});

// Obtener productos por tienda con categorías y variantes (CORREGIDO)
router.get("/:tiendaId", (req, res) => {
  // Primero obtener los productos
  const productosQuery = `
    SELECT 
      p.*,
      c.nombre as categoria_nombre,
      c.orden as categoria_orden
    FROM productos p
    LEFT JOIN categorias_productos c ON p.categoria_id = c.id
    WHERE p.tienda_id = ? AND p.disponible = 1
    ORDER BY c.orden, p.orden, p.nombre
  `;

  db.all(productosQuery, [req.params.tiendaId], (err, productos) => {
    if (err) return res.status(400).json({ error: err.message });

    if (productos.length === 0) {
      return res.json([]);
    }

    // Obtener variantes para todos los productos
    const productosIds = productos.map(p => p.id);
    const variantesQuery = `
      SELECT * FROM producto_variantes 
      WHERE producto_id IN (${productosIds.map(() => '?').join(',')}) AND disponible = 1
      ORDER BY orden, nombre
    `;

    db.all(variantesQuery, productosIds, (err, variantes) => {
      if (err) return res.status(400).json({ error: err.message });

      // Agrupar variantes por producto
      const variantesPorProducto = {};
      variantes.forEach(variante => {
        if (!variantesPorProducto[variante.producto_id]) {
          variantesPorProducto[variante.producto_id] = [];
        }
        variantesPorProducto[variante.producto_id].push(variante);
      });

      // Combinar productos con sus variantes
      const productosConVariantes = productos.map(producto => ({
        ...producto,
        variantes: variantesPorProducto[producto.id] || []
      }));

      res.json(productosConVariantes);
    });
  });
});

// Obtener producto específico con todas sus imágenes
router.get("/detalle/:productoId", (req, res) => {
  const query = `
    SELECT 
      p.*,
      c.nombre as categoria_nombre,
      t.nombre as tienda_nombre
    FROM productos p
    LEFT JOIN categorias_productos c ON p.categoria_id = c.id
    LEFT JOIN tiendas t ON p.tienda_id = t.id
    WHERE p.id = ?
  `;

  db.get(query, [req.params.productoId], (err, producto) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!producto) return res.status(404).json({ error: "Producto no encontrado" });

    // Obtener variantes
    db.all(
      "SELECT * FROM producto_variantes WHERE producto_id = ? ORDER BY orden, nombre",
      [req.params.productoId],
      (err, variantes) => {
        if (err) return res.status(400).json({ error: err.message });

        // Obtener imágenes adicionales
        db.all(
          "SELECT * FROM producto_imagenes WHERE producto_id = ? ORDER BY orden",
          [req.params.productoId],
          (err, imagenes) => {
            if (err) return res.status(400).json({ error: err.message });

            res.json({
              ...producto,
              variantes: variantes || [],
              imagenes: imagenes || []
            });
          }
        );
      }
    );
  });
});
// Agregar esta nueva ruta para el panel de administración (muestra TODOS los productos)
router.get("/admin/:tiendaId", (req, res) => {
  const productosQuery = `
    SELECT 
      p.*,
      c.nombre as categoria_nombre,
      c.orden as categoria_orden
    FROM productos p
    LEFT JOIN categorias_productos c ON p.categoria_id = c.id
    WHERE p.tienda_id = ?
    ORDER BY c.orden, p.orden, p.nombre
  `;

  db.all(productosQuery, [req.params.tiendaId], (err, productos) => {
    if (err) return res.status(400).json({ error: err.message });

    if (productos.length === 0) {
      return res.json([]);
    }

    const productosIds = productos.map(p => p.id);
    const variantesQuery = `
      SELECT * FROM producto_variantes 
      WHERE producto_id IN (${productosIds.map(() => '?').join(',')})
      ORDER BY orden, nombre
    `;

    db.all(variantesQuery, productosIds, (err, variantes) => {
      if (err) return res.status(400).json({ error: err.message });

      const variantesPorProducto = {};
      variantes.forEach(variante => {
        if (!variantesPorProducto[variante.producto_id]) {
          variantesPorProducto[variante.producto_id] = [];
        }
        variantesPorProducto[variante.producto_id].push(variante);
      });

      const productosConVariantes = productos.map(producto => ({
        ...producto,
        variantes: variantesPorProducto[producto.id] || []
      }));

      res.json(productosConVariantes);
    });
  });
});

// Nueva ruta para cambiar solo el estado (activar/desactivar)
router.patch("/:productoId/toggle-status", (req, res) => {
  const { disponible } = req.body;

  db.run(
    "UPDATE productos SET disponible = ? WHERE id = ?",
    [disponible ? 1 : 0, req.params.productoId],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Producto no encontrado" });
      res.json({
        message: disponible ? "Producto activado correctamente" : "Producto desactivado correctamente",
        disponible: disponible ? 1 : 0
      });
    }
  );
});

// Modificar la ruta DELETE para eliminar permanentemente
router.delete("/:productoId", (req, res) => {
  // Primero eliminar las variantes
  db.run("DELETE FROM producto_variantes WHERE producto_id = ?", [req.params.productoId], (err) => {
    if (err) return res.status(400).json({ error: err.message });

    // Luego eliminar las imágenes adicionales
    db.run("DELETE FROM producto_imagenes WHERE producto_id = ?", [req.params.productoId], (err) => {
      if (err) return res.status(400).json({ error: err.message });

      // Finalmente eliminar el producto
      db.run("DELETE FROM productos WHERE id = ?", [req.params.productoId], function (err) {
        if (err) return res.status(400).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Producto no encontrado" });
        res.json({ message: "Producto eliminado permanentemente del sistema" });
      });
    });
  });
});
// ==================== VARIANTES ====================

// Agregar variante a producto
router.post("/:productoId/variantes", (req, res) => {
  const { nombre, precio, orden } = req.body;

  db.run(
    "INSERT INTO producto_variantes (producto_id, nombre, precio, orden) VALUES (?, ?, ?, ?)",
    [req.params.productoId, nombre, precio, orden || 0],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({
        id: this.lastID,
        producto_id: req.params.productoId,
        nombre,
        precio,
        orden: orden || 0,
        disponible: 1
      });
    }
  );
});

// Obtener variantes de un producto
router.get("/:productoId/variantes", (req, res) => {
  db.all(
    "SELECT * FROM producto_variantes WHERE producto_id = ? ORDER BY orden, nombre",
    [req.params.productoId],
    (err, rows) => {
      if (err) return res.status(400).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Actualizar variante
router.put("/variantes/:varianteId", (req, res) => {
  const { nombre, precio, disponible, orden } = req.body;

  db.run(
    "UPDATE producto_variantes SET nombre = ?, precio = ?, disponible = ?, orden = ? WHERE id = ?",
    [nombre, precio, disponible !== undefined ? disponible : 1, orden || 0, req.params.varianteId],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Variante no encontrada" });
      res.json({ message: "Variante actualizada correctamente" });
    }
  );
});

// Eliminar variante
router.delete("/variantes/:varianteId", (req, res) => {
  db.run(
    "DELETE FROM producto_variantes WHERE id = ?",
    [req.params.varianteId],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Variante no encontrada" });
      res.json({ message: "Variante eliminada correctamente" });
    }
  );
});

// ==================== IMÁGENES ADICIONALES ====================

// Agregar imágenes adicionales a producto
router.post("/:productoId/imagenes", upload.array('imagenes', 5), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No se enviaron imágenes" });
  }

  const imagenes = req.files.map((file, index) => [
    req.params.productoId,
    `/uploads/productos/${file.filename}`,
    req.body.alt_text || `Imagen ${index + 1}`,
    index
  ]);

  const placeholders = imagenes.map(() => "(?, ?, ?, ?)").join(", ");
  const flatValues = imagenes.flat();

  db.run(
    `INSERT INTO producto_imagenes (producto_id, url_imagen, alt_text, orden) VALUES ${placeholders}`,
    flatValues,
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({
        message: `${imagenes.length} imágenes agregadas correctamente`,
        imagenes: req.files.map(file => `/uploads/productos/${file.filename}`)
      });
    }
  );
});

// ==================== BÚSQUEDA Y FILTROS ====================

// Buscar productos
router.get("/buscar/:tiendaId", (req, res) => {
  const { q, categoria } = req.query;
  let query = `
    SELECT 
      p.*,
      c.nombre as categoria_nombre
    FROM productos p
    LEFT JOIN categorias_productos c ON p.categoria_id = c.id
    WHERE p.tienda_id = ? AND p.disponible = 1
  `;
  const params = [req.params.tiendaId];

  if (q) {
    query += " AND (p.nombre LIKE ? OR p.descripcion LIKE ?)";
    params.push(`%${q}%`, `%${q}%`);
  }

  if (categoria) {
    query += " AND p.categoria_id = ?";
    params.push(categoria);
  }

  query += " ORDER BY p.nombre";

  db.all(query, params, (err, rows) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json(rows);
  });
});

// ==================== ACTUALIZACIÓN Y ELIMINACIÓN ====================

// Actualizar producto
router.put("/:productoId", upload.single('imagen_principal'), (req, res) => {
  const { nombre, descripcion, precio_base, categoria_id, disponible, orden } = req.body;
  let query = "UPDATE productos SET nombre = ?, descripcion = ?, precio_base = ?, categoria_id = ?, disponible = ?, orden = ?";
  let params = [
    nombre,
    descripcion,
    precio_base,
    categoria_id || null,
    disponible !== undefined ? disponible : 1,
    orden || 0
  ];

  if (req.file) {
    query += ", imagen_principal = ?";
    params.push(`/uploads/productos/${req.file.filename}`);
  }

  query += " WHERE id = ?";
  params.push(req.params.productoId);

  db.run(query, params, function (err) {
    if (err) return res.status(400).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Producto no encontrado" });
    res.json({ message: "Producto actualizado correctamente" });
  });
});

// Eliminar producto (marcar como no disponible)
router.delete("/:productoId", (req, res) => {
  db.run("UPDATE productos SET disponible = 0 WHERE id = ?", [req.params.productoId], function (err) {
    if (err) return res.status(400).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Producto no encontrado" });
    res.json({ message: "Producto eliminado correctamente" });
  });
});

// ==================== ESTADÍSTICAS ====================

// Obtener estadísticas de productos
router.get("/stats/:tiendaId", (req, res) => {
  const queries = {
    total_productos: "SELECT COUNT(*) as count FROM productos WHERE tienda_id = ? AND disponible = 1",
    productos_sin_categoria: "SELECT COUNT(*) as count FROM productos WHERE tienda_id = ? AND categoria_id IS NULL AND disponible = 1",
    productos_con_variantes: "SELECT COUNT(DISTINCT p.id) as count FROM productos p INNER JOIN producto_variantes v ON p.id = v.producto_id WHERE p.tienda_id = ? AND p.disponible = 1 AND v.disponible = 1",
    precio_promedio: "SELECT AVG(precio_base) as promedio FROM productos WHERE tienda_id = ? AND disponible = 1"
  };

  const stats = {};
  const promises = Object.keys(queries).map(key => {
    return new Promise((resolve) => {
      db.get(queries[key], [req.params.tiendaId], (err, result) => {
        if (!err) {
          stats[key] = result?.count || result?.promedio || 0;
        }
        resolve();
      });
    });
  });

  Promise.all(promises).then(() => {
    stats.precio_promedio = stats.precio_promedio ? parseFloat(stats.precio_promedio).toFixed(2) : '0.00';
    res.json(stats);
  });
});

module.exports = router;