require('dotenv').config();
const express = require('express');
const { Pool } = require('pg'); // Cambia de sqlite3 a pg
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

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
    const result = await pool.query('SELECT id, nombrecomun AS "nombreComun", nombrecientifico AS "nombreCientifico", descripcion, imagen FROM plantas');
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
    const sql = `SELECT id, nombrecomun AS "nombreComun", nombrecientifico AS "nombreCientifico", descripcion, imagen FROM plantas WHERE nombrecomun ILIKE $1 OR nombrecientifico ILIKE $1`;
    const result = await pool.query(sql, [`%${query}%`]);
    console.log('Resultados de búsqueda:', result.rows.length);
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /api/plantas/search:', err);
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

// Servir frontend para rutas no API
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/index.html'));
});

// Cerrar pool al salir (opcional, para desarrollo)
process.on('exit', () => pool.end());

// Iniciar servidor
const PORT = process.env.PORT || 5004;
app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));