require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Iniciar servidor con: ./start.sh (o node server.js si el puerto está libre)
/*
curl -X POST http://localhost:5004/api/plantas \
  -H "Content-Type: application/json" \
  -d '{
    "nombreComun": "Rosa Roja",
    "nombreCientifico": "Rosa rubiginosa",
    "descripcion": "Flor aromática y colorida, símbolo de amor.",
    "imagen": ""
  }'
*/

// Conectar a SQLite (crea 'plantas.db' si no existe)
const db = new sqlite3.Database('./plantas.db', (err) => {
  if (err) {
    console.error('Error conectando a SQLite:', err.message);
  } else {
    console.log('Conectado a SQLite.');
    // Crear tabla después de conectar
    db.run(`
      CREATE TABLE IF NOT EXISTS plantas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombreComun TEXT NOT NULL,
        nombreCientifico TEXT NOT NULL,
        descripcion TEXT NOT NULL,
        imagen TEXT
      )
    `, (err) => {
      if (err) {
        console.error('Error creando tabla:', err.message);
      } else {
        console.log('Tabla plantas creada o ya existe.');
        // Verificar si hay plantas, si no, insertar iniciales
        db.get('SELECT COUNT(*) as count FROM plantas', [], (err, row) => {
          if (err) {
            console.error('Error verificando plantas:', err);
          } else if (row.count === 0) {
          } else {
            console.log('Datos iniciales ya existen.');
          }
        });
      }
    });
  }
});

// Rutas API
// Obtener todas las plantas
app.get('/api/plantas', (req, res) => {
  db.all('SELECT * FROM plantas', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

// Buscar plantas (por nombre común o científico)
app.get('/api/plantas/search', (req, res) => {
  const query = req.query.q || '';
  const sql = `
    SELECT * FROM plantas
    WHERE nombreComun LIKE ? OR nombreCientifico LIKE ?
  `;
  const params = [`%${query}%`, `%${query}%`];
  db.all(sql, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});


// Agregar una nueva planta
app.post('/api/plantas', (req, res) => {
  const { nombreComun, nombreCientifico, descripcion, imagen } = req.body;
  const sql = 'INSERT INTO plantas (nombreComun, nombreCientifico, descripcion, imagen) VALUES (?, ?, ?, ?)';
  db.run(sql, [nombreComun, nombreCientifico, descripcion, imagen], function(err) {
    if (err) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(201).json({ id: this.lastID, nombreComun, nombreCientifico, descripcion, imagen });
    }
  });
});

// Cerrar BD al salir (opcional, para desarrollo)
process.on('exit', () => db.close());

// Iniciar servidor
const PORT = 5004;
app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));