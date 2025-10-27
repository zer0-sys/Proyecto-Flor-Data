require('dotenv').config();
const express = require('express');
const { Pool } = require('pg'); // Cambia de sqlite3 a pg
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({ dest: 'uploads/' }); // Carpeta temporal

// Conectar a PostgreSQL (en Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Cambia a true para Supabase
  connectionTimeoutMillis: 10000 // Timeout de 10 segundos
});

// Crear tabla si no existe (comentado porque ya la creaste manualmente en Supabase)
/*
pool.query(`
  CREATE TABLE IF NOT EXISTS plantas (
    id SERIAL PRIMARY KEY,
    nombreComun TEXT NOT NULL,
    nombreCientifico TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    imagen TEXT
  )
`, (err) => {
  if (err) {
    console.error('Error creando tabla:', err);
  } else {
    console.log('Tabla plantas creada o ya existe.');
  }
});
*/

// Rutas API
// Obtener todas las plantas
app.get('/api/plantas', async (req, res) => {
  console.log('Intentando obtener plantas...');
  try {
    const result = await pool.query('SELECT id, nombrecomun AS "nombreComun", nombrecientifico AS "nombreCientifico", descripcion, descripcioncompleta AS "descripcionCompleta", curiosidades, imagen FROM plantas ORDER BY nombrecomun ASC');
    console.log('Plantas obtenidas:', result.rows.length);
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /api/plantas:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
});

// Buscar plantas (por nombre común o científico)
app.get('/api/plantas/search', async (req, res) => {
  const query = req.query.q || '';
  console.log('Buscando plantas con query:', query);
  try {
    const sql = `SELECT id, nombrecomun AS "nombreComun", nombrecientifico AS "nombreCientifico", descripcion, descripcioncompleta AS "descripcionCompleta", curiosidades, imagen FROM plantas WHERE nombrecomun ILIKE $1 OR nombrecientifico ILIKE $1 ORDER BY nombrecomun ASC`;
    const result = await pool.query(sql, [`%${query}%`]);
    console.log('Resultados de búsqueda:', result.rows.length);
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /api/plantas/search:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
});

// Obtener una planta por ID
app.get('/api/plantas/:id', async (req, res) => {
  const { id } = req.params;
  console.log('Obteniendo planta con ID:', id);
  try {
  const sql = 'SELECT id, nombrecomun AS "nombreComun", nombrecientifico AS "nombreCientifico", descripcion, descripcioncompleta AS "descripcionCompleta", curiosidades, imagen FROM plantas WHERE id = $1';
    const result = await pool.query(sql, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Planta no encontrada' });
    }
    console.log('Planta obtenida:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en GET /api/plantas/:id:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
});

// Agregar una nueva planta
app.post('/api/plantas', async (req, res) => {
  const { nombreComun, nombreCientifico, descripcion, imagen } = req.body;
  console.log('Agregando planta:', { nombreComun, nombreCientifico });
  try {
    const sql = 'INSERT INTO plantas (nombreComun, nombreCientifico, descripcion, imagen) VALUES ($1, $2, $3, $4) RETURNING id';
    const result = await pool.query(sql, [nombreComun, nombreCientifico, descripcion, imagen]);
    console.log('Planta agregada con ID:', result.rows[0].id);
    res.status(201).json({ id: result.rows[0].id, nombreComun, nombreCientifico, descripcion, imagen });
  } catch (err) {
    console.error('Error en POST /api/plantas:', err);
    res.status(400).json({ error: err.message || 'Error interno' });
  }
});

// Subir imagen a Cloudinary
app.post('/api/upload', upload.single('imagen'), async (req, res) => {
  try {
    const result = await cloudinary.uploader.upload(req.file.path);
    res.json({ url: result.secure_url });
  } catch (err) {
    console.error('Error subiendo imagen:', err);
    res.status(500).json({ error: err.message });
  }
});

// Servir frontend para rutas no API **solo** cuando el cliente acepte HTML.
// Esto evita que peticiones a recursos (ej. /downloads/Proyecto-Flor-Data.apk) devuelvan
// el HTML de la SPA y sean descargadas como un archivo erróneo.
app.get('*', (req, res, next) => {
  // Si la ruta solicita un archivo con extensión (ej. .apk, .png, .js),
  // no devolvemos index.html. Dejar que express.static maneje el archivo.
  const ext = require('path').extname(req.path);
  if (ext) {
    return next();
  }

  // Si la ruta NO tiene extensión, asumimos navegación de SPA y devolvemos index.html
  return res.sendFile(path.join(__dirname, 'frontend/index.html'));
});

// Cerrar pool al salir (opcional, para desarrollo)
process.on('exit', () => pool.end());

// Iniciar servidor
const PORT = process.env.PORT || 5004;
app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));