require('dotenv').config({ path: './backend/.env' });
require('dotenv').config(); // Fallback si ejecutas desde la raíz
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const crypto = require('crypto');
const fs = require('fs');
const axios = require('axios');
const { exec } = require('child_process');


const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  generationConfig: { responseMimeType: "text/plain" }
});

const app = express();
app.use(cors());
app.use(express.json());

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'frontend')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Para que la web pueda ver la foto con pasto rojo

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({ dest: 'uploads/' });

// Conectar a PostgreSQL (en Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000
});

// ==========================================
// RUTAS API DE LA BIBLIOTECA BOTÁNICA
// ==========================================

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

// Buscar plantas
app.get('/api/plantas/search', async (req, res) => {
  const query = req.query.q || '';
  console.log('Buscando plantas con query:', query);
  try {
    const sql = `SELECT id, nombrecomun AS "nombreComun", nombrecientifico AS "nombreCientifico", descripcion, descripcioncompleta AS "descripcionCompleta", curiosidades, imagen FROM plantas WHERE nombrecomun ILIKE $1 OR nombrecientifico ILIKE $1 ORDER BY nombrecomun ASC`;
    const result = await pool.query(sql, [`%${query}%`]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /api/plantas/search:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
});

// Obtener una planta por ID
app.get('/api/plantas/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = 'SELECT id, nombrecomun AS "nombreComun", nombrecientifico AS "nombreCientifico", descripcion, descripcioncompleta AS "descripcionCompleta", curiosidades, imagen FROM plantas WHERE id = $1';
    const result = await pool.query(sql, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Planta no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en GET /api/plantas/:id:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
});

// Conteo de plantas en el censo
app.get('/api/censo/count', async (req, res) => {

  const nombre = req.query.nombre;
  try {
    const result = await pool.query(
      'SELECT COUNT(*) FROM registro_censo WHERE nombre_identificado ILIKE $1',
      [`%${nombre}%`]
    );
    res.json({ count: result.rows[0].count });
  } catch (err) {
    console.error('Error obteniendo conteo del censo:', err);
    res.status(500).json({ error: 'Error interno al contar' });
  }

});
// NUEVA RUTA: Obtener todas las ubicaciones del censo para el Radar Táctico
app.get('/api/censo/ubicaciones', async (req, res) => {
  try {
    // Buscamos todas las plantas que tengan coordenadas válidas
    const sql = 'SELECT nombre_identificado, latitud, longitud FROM registro_censo WHERE latitud IS NOT NULL AND longitud IS NOT NULL';
    const result = await pool.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener ubicaciones del mapa:', err);
    res.status(500).json({ error: 'Error interno al cargar el mapa' });
  }
});

// Agregar una nueva planta manualmente
app.post('/api/plantas', async (req, res) => {
  const { nombreComun, nombreCientifico, descripcion, imagen } = req.body;
  try {
    const sql = 'INSERT INTO plantas (nombreComun, nombreCientifico, descripcion, imagen) VALUES ($1, $2, $3, $4) RETURNING id';
    const result = await pool.query(sql, [nombreComun, nombreCientifico, descripcion, imagen]);
    res.status(201).json({ id: result.rows[0].id, nombreComun, nombreCientifico, descripcion, imagen });
  } catch (err) {
    console.error('Error en POST /api/plantas:', err);
    res.status(400).json({ error: err.message || 'Error interno' });
  }
});

// Subir imagen suelta a Cloudinary
app.post('/api/upload', upload.single('imagen'), async (req, res) => {
  try {
    const result = await cloudinary.uploader.upload(req.file.path);
    res.json({ url: result.secure_url });
  } catch (err) {
    console.error('Error subiendo imagen:', err);
    res.status(500).json({ error: err.message });
  }
});


const crypto = require('crypto');
const axios = require('axios');

// ==========================================
// RUTA SECRETA PARA POBLAR HASHES VACÍOS
// ==========================================
app.get('/admin/generar-hashes', async (req, res) => {
    try {
        // 1. Obtener plantas que no tienen hash en la tabla "plantas"
        const dbResult = await pool.query("SELECT id, imagen_url FROM plantas WHERE hash_foto IS NULL");
        const plantas = dbResult.rows;

        if (!plantas || plantas.length === 0) {
            return res.send("✅ Todas las plantas de la biblioteca ya tienen su hash.");
        }

        // res.write() nos permite ir mostrando texto en la pantalla poco a poco
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.write(`Se encontraron ${plantas.length} plantas sin hash. Procesando...\n\n`);

        for (let planta of plantas) {
            if (planta.imagen_url) {
                try {
                    // 2. Descargar imagen de Cloudinary a la memoria
                    const respuesta = await axios.get(planta.imagen_url, { responseType: 'arraybuffer' });
                    const bufferImagen = Buffer.from(respuesta.data, 'binary');

                    // 3. Generar el HASH IGUAL QUE EN TU CÓDIGO
                    const hashCalculado = crypto.createHash('md5').update(bufferImagen).digest('hex');

                    // 4. Guardar en la base de datos
                    await pool.query("UPDATE plantas SET hash_foto = $1 WHERE id = $2", [hashCalculado, planta.id]);

                    res.write(`✅ Hash actualizado para ID ${planta.id} -> ${hashCalculado}\n`);
                } catch (errFoto) {
                    res.write(`❌ Error procesando ID ${planta.id}: ${errFoto.message}\n`);
                }
            }
        }

        res.end("\n🎉 ¡Proceso terminado! Todas las fotos tienen su hash.");
    } catch (error) {
        console.error("Error en admin/generar-hashes:", error);
        res.end("❌ Hubo un error general: " + error.message);
    }
});

// ==========================================
// RUTA DE INTELIGENCIA ARTIFICIAL Y CENSO
// ==========================================

app.post('/api/identificar-planta', upload.single('imagen'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No se subió ninguna imagen." });
    }

    const imagePath = req.file.path;
    const fileBuffer = fs.readFileSync(imagePath);

    // 1. Generar HASH para evitar fotos duplicadas
    const hashFoto = crypto.createHash('md5').update(fileBuffer).digest('hex');
    // Donde generas o calculas el hash de la imagen:
    console.log("==========================================");
    console.log("📸 NUEVA FOTO ENVIADA AL CHAT");
    console.log("🔑 HASH PARA SUPABASE:", hashFoto);
    console.log("==========================================");

    // ==========================================
    // NIVEL 1: ESCUDO OPENCV (PYTHON)
    // ==========================================
    let porcentajePasto = "0.00";
    let imagenMascara = "";
    let hojasEstimadas = "0";

    try {
      const pythonResult = await new Promise((resolve, reject) => {
        // CÓDIGO CORREGIDO "A LA ANTIGUA"
        exec("python analizar_pasto.py \"" + imagePath + "\"", (error, stdout, stderr) => {
          if (error) {
            console.warn("Error ejecutando Python:", error.message);
            resolve({ porcentaje: "0.00", imagen: "", hojas: "0" });
          } else {
            try {
              const lineas = stdout.trim().split('\n');
              const ultimaLinea = lineas[lineas.length - 1].trim();
              const datos = JSON.parse(ultimaLinea);
              resolve(datos);
            } catch (e) {
              console.error("Error parseando JSON:", e);
              resolve({ porcentaje: "0.00", imagen: "", hojas: "0" });
            }
          }
        });
      });

      porcentajePasto = pythonResult.porcentaje;
      imagenMascara = pythonResult.imagen;
      hojasEstimadas = pythonResult.hojas;

      // CÓDIGO CORREGIDO "A LA ANTIGUA"
      console.log("IA OpenCV detectó: " + porcentajePasto + "% de vegetación.");

    } catch (e) {
      console.error("Error general en proceso de medición de pasto:", e);
    }

    // 🛡️ ACTIVACIÓN DEL ESCUDO: Si no hay casi verde, abortamos para no gastar IA
    if (parseFloat(porcentajePasto) < 5.0) {
      console.log("Escudo activado: No hay suficiente vegetación. Abortando petición a la API.");
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);

      return res.json({
        encontrado: false,
        nombreSugerido: "Objeto no botánico",
        mensaje: "No logro detectar suficiente vegetación en esta imagen. ¡Intenta enfocar mejor las hojas o el tallo de la planta!",
        porcentajePasto: porcentajePasto,
        imagenMascara: imagenMascara
      });
    }

    // Preparamos la imagen para enviarla a la nube
    const imageBase64 = fileBuffer.toString('base64');

    // CÓDIGO CORREGIDO "A LA ANTIGUA"
    const imageDataUrl = "data:image/jpeg;base64," + imageBase64;
    let nombrePlanta = "DESCONOCIDO";
    let nombreComunBusqueda = "DESCONOCIDO";
    let nombreCientificoBusqueda = "DESCONOCIDO";
    // ==========================================
    // NIVEL 2: CARRERA DE IAs GRATUITAS (Ejecución en paralelo)
    // ==========================================
    try {
      console.log("Iniciando carrera de IAs (NVIDIA vs Groq)...");

      // 1. Preparamos el mensaje exacto que le enviaremos a todas las IAs
      const promptExperto = "Eres un botánico experto. Analiza esta imagen. Si la reconoces con seguridad, responde OBLIGATORIAMENTE en este formato exacto: Nombre Común|Nombre Científico (ejemplo: Palma Areca|Dypsis lutescens). Si tienes dudas, responde: DESCONOCIDO. No saludes ni des explicaciones, solo el formato indicado."; const mensajesIA = [{
        role: "user",
        content: [
          { type: "text", text: promptExperto },
          { type: "image_url", image_url: { url: imageDataUrl } }
        ]
      }];

      // 2. Creamos un "molde" (función) para lanzar a los competidores
      const lanzarCompetidor = async (nombre, url, token, modelo) => {
        const respuesta = await axios.post(url, {
          model: modelo,
          messages: mensajesIA,
          max_tokens: 50,
          temperature: 0.0
        }, {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
            "Content-Type": "application/json"
          },
          timeout: 10000 // ⏱️ LÍMITE DE 10 SEGUNDOS
        });

        const resultado = respuesta.data.choices[0].message.content.trim();

        // Si no sabe, lanzamos un error a propósito para descalificar a este competidor
        if (resultado.includes("DESCONOCIDO")) {
          throw new Error(`${nombre} no supo la respuesta.`);
        }

        console.log(`🏆 ¡Ganador de la carrera! ${nombre} respondió primero con: ${resultado}`);
        return resultado;
      };

      // 3. ¡ARRANCA LA CARRERA! (Promise.any elige al primero que termine con éxito)
      nombrePlanta = await Promise.any([
        lanzarCompetidor("NVIDIA (Llama 90b)", 'https://integrate.api.nvidia.com/v1/chat/completions', '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', 'meta/llama-3.2-90b-vision-instruct'),
        lanzarCompetidor("NVIDIA (Llama 11b rápida)", 'https://integrate.api.nvidia.com/v1/chat/completions', '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', 'meta/llama-3.2-11b-vision-instruct'),
        lanzarCompetidor("Groq (Llama 90b)", 'https://api.groq.com/openai/v1/chat/completions', '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', 'llama-3.2-90b-vision-preview')
      ]);

      console.log("IA ganadora identificó: " + nombrePlanta);

      // 👇 ¡NUEVO: Separamos el nombre común y el científico! 👇
      if (nombrePlanta.includes('|')) {
        const partes = nombrePlanta.split('|');
        nombreComunBusqueda = partes[0].replace(/[.,]/g, '').trim();
        nombreCientificoBusqueda = partes[1].replace(/[.,]/g, '').trim();
        nombrePlanta = nombreComunBusqueda; // Dejamos el común para mensajes y censo
      } else {
        nombrePlanta = nombrePlanta.replace(/[.,]/g, '').trim();
        nombreComunBusqueda = nombrePlanta;
        nombreCientificoBusqueda = nombrePlanta;
      }

    } catch (carreraError) {
      // Si llega aquí, significa que las 3 fallaron, dieron error 504, o las 3 dijeron "DESCONOCIDO"
      console.log("Ninguna IA gratuita logró identificarla a tiempo o con seguridad. Pasando a Plant.id...");
      nombrePlanta = "DESCONOCIDO";
    }

    // ==========================================
    // NIVEL 3: LABORATORIO DE PAGA (PLANT.ID - FALLBACK)
    // ==========================================
    if (nombrePlanta.toUpperCase().includes("DESCONOCIDO")) {
      console.log("NVIDIA no está seguro. Llamando a Plant.id...");

      // 👇 Extraemos la llave que mandó el frontend
      const llaveDelUsuario = req.body.llavePlantId;

      if (!llaveDelUsuario) {
        console.log("El usuario no ingresó API Key. Abortando Nivel 3.");
        throw new Error("Se requiere tu propia API Key de Plant.id para plantas difíciles.");
      }

      try {
        console.log("Consumiendo 1 Crédito de la cuenta del usuario...");
        const response = await axios.post('https://api.plant.id/v2/identify', {
          images: [imageBase64],
          organs: ["leaf"]
        }, {
          headers: {
            'Api-Key': llaveDelUsuario, // 👈 ¡MAGIA! Usamos la llave del usuario
            'Content-Type': 'application/json'
          }
        });

        nombrePlanta = response.data.suggestions[0].plant_name;
        nombreComunBusqueda = nombrePlanta;
        nombreCientificoBusqueda = nombrePlanta;
        console.log("Plant.id identificó: " + nombrePlanta);

      } catch (plantIdErr) {
        console.error("Error en Plant.id:", plantIdErr.message);
        throw new Error("La API Key es inválida o el laboratorio falló.");
      }
    }

    // ==========================================
    // LÓGICA DE BASE DE DATOS Y CENSO
    // ==========================================

    // 👇 ¡NUEVO: Extraemos la 'zona' que calculó el frontend! 👇
    const { latitud, longitud, zona } = req.body;
    const zonaPlanta = zona || 'General'; // Si por algo falla, le ponemos 'General' por defecto

    // Disparamos la búsqueda buscando coincidencias con el nombre común OR el científico
    const queryCenso = "SELECT * FROM registro_censo WHERE (nombre_identificado ILIKE $1 OR nombre_identificado ILIKE $2) AND (hash_foto = $3 OR (ABS(latitud - $4::numeric) < 0.0001 AND ABS(longitud - $5::numeric) < 0.0001)) LIMIT 1";
    const dbResultCenso = await pool.query(queryCenso, ["%" + nombreComunBusqueda + "%", "%" + nombreCientificoBusqueda + "%", hashFoto, latitud, longitud]);

    let queryBiblioteca = 'SELECT * FROM plantas WHERE nombreComun ILIKE $1 OR nombreCientifico ILIKE $1 OR nombreComun ILIKE $2 OR nombreCientifico ILIKE $2 LIMIT 1';

    if (dbResultCenso.rows.length > 0) {
      // Ya estaba en el censo
      const busquedaNormal = await pool.query(queryBiblioteca, ["%" + nombreComunBusqueda + "%", "%" + nombreCientificoBusqueda + "%"]); res.json({
        encontrado: true,
        datos: busquedaNormal.rows[0],
        porcentajePasto: porcentajePasto,
        imagenMascara: imagenMascara,
        hojasEstimadas: hojasEstimadas,
        zonaUbicacion: zonaPlanta, // 👈 Enviamos la zona de vuelta a la app
        mensaje: "¡Excelente! Ejemplar ya existente en el censo identificado con éxito."
      });
    } else {
      // Es nueva, hay que insertarla
      if (latitud && longitud) {
        try {
          // 👇 ¡NUEVO: Agregamos 'zona' al INSERT de la base de datos! 👇
          await pool.query(
            'INSERT INTO registro_censo (nombre_identificado, latitud, longitud, hash_foto, zona) VALUES ($1, $2, $3, $4, $5)',
            [nombrePlanta, latitud, longitud, hashFoto, zonaPlanta]
          );
          console.log("📍 ¡Nuevo registro en el censo! Agregado en zona: " + zonaPlanta);
        } catch (dbError) {
          if (dbError.message.includes('unique constraint') || dbError.message.includes('hash_foto_key')) {
            console.log("⚠️ Aviso: Foto duplicada omitida.");
          } else {
            console.error("Error guardando en la BD:", dbError.message);
          }
        }
      }

      const busquedaNormal = await pool.query(queryBiblioteca, ["%" + nombreComunBusqueda + "%", "%" + nombreCientificoBusqueda + "%"]);
      if (busquedaNormal.rows.length > 0) {
        res.json({
          encontrado: true,
          datos: busquedaNormal.rows[0],
          porcentajePasto: porcentajePasto,
          imagenMascara: imagenMascara,
          zonaUbicacion: zonaPlanta, // 👈 Enviamos la zona de vuelta a la app
          mensaje: "¡Excelente! Has registrado un nuevo ejemplar para el censo."
        });
      } else {
        res.json({
          encontrado: false,
          nombreSugerido: nombrePlanta,
          porcentajePasto: porcentajePasto,
          imagenMascara: imagenMascara,
          zonaUbicacion: zonaPlanta, // 👈 Enviamos la zona de vuelta a la app
          mensaje: "Identificada como: " + nombrePlanta + ". (Nueva en el censo, pero no en biblioteca)."
        });
      }
    }

    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

  } catch (err) {
    console.error("Error en proceso de identificación:", err.message);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: "No se pudo identificar la planta." });
  }
});


// ==========================================
// RUTA FASE 3: RE-IDENTIFICACIÓN DIRECTA CON PLANT.ID
// ==========================================
app.post('/api/re-identificar', upload.single('imagen'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No se subió ninguna imagen." });

    const imagePath = req.file.path;
    const fileBuffer = fs.readFileSync(imagePath);
    const imageBase64 = fileBuffer.toString('base64');
    
    const llaveDelUsuario = req.body.llavePlantId;
    if (!llaveDelUsuario) {
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
      return res.status(400).json({ error: "Se requiere API Key de Plant.id para la segunda opinión." });
    }

    console.log("Iniciando re-identificación directa con Plant.id...");

    const response = await axios.post('https://api.plant.id/v2/identify', {
      images: [imageBase64],
      organs: ["leaf"]
    }, {
      headers: {
        'Api-Key': llaveDelUsuario,
        'Content-Type': 'application/json'
      }
    });

    let nombrePlanta = response.data.suggestions[0].plant_name;
    console.log("Plant.id (Segunda opinión) identificó: " + nombrePlanta);

    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);

    res.json({
      exito: true,
      nuevoNombre: nombrePlanta,
      mensaje: "Segunda opinión completada por laboratorio botánico."
    });

  } catch (err) {
    console.error("Error en re-identificación:", err.message);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: "El laboratorio falló al intentar re-identificar." });
  }
});


// ==========================================
// RUTA GAMIFICACIÓN: GUARDAR PUNTAJE AL TERMINAR
// ==========================================
app.post('/api/ranking', async (req, res) => {
  const { nombre_equipo, puntaje, zona, integrantes, integrantes_del_equipo } = req.body;
  
  try {
    if (puntaje === 0) {
      return res.json({ exito: true, mensaje: 'Puntaje 0 omitido.' });
    }

    // Capturar variables con fallback
    const equipoFinal = (nombre_equipo && nombre_equipo.trim() !== '') ? nombre_equipo.trim() : 'Equipo Explorador';
    const zonaFinal = (zona && zona.trim() !== '') ? zona.trim() : 'Los Cerritos';
    const numIntegrantes = parseInt(integrantes || integrantes_del_equipo || 1);

    const sql = `
      INSERT INTO ranking_equipos (nombre_equipo, puntaje, zona, integrantes_del_equipo) 
      VALUES ($1, $2, $3, $4)
    `;
    
    await pool.query(sql, [
      equipoFinal, 
      puntaje, 
      zonaFinal,
      numIntegrantes
    ]);
    
    console.log(`🏆 Puntaje guardado: "${equipoFinal}" (${numIntegrantes} integrantes, Zona: ${zonaFinal}) hizo ${puntaje} pts.`);
    res.json({ exito: true, mensaje: 'Puntaje guardado en la base de datos.' });
    
  } catch (err) {
    console.error('❌ Error guardando en ranking_equipos:', err.message);
    res.status(500).json({ error: 'Error interno al guardar ranking' });
  }
});

// ==========================================
// RUTA GAMIFICACIÓN: OBTENER EL TOP 10
// ==========================================
app.get('/api/ranking', async (req, res) => {
  try {
    const query = 'SELECT nombre_equipo, puntaje, zona, integrantes_del_equipo FROM ranking_equipos ORDER BY puntaje DESC LIMIT 10';
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener el ranking:', error.message);
    res.status(500).json({ error: 'Error interno al cargar la tabla' });
  }
});


// ==========================================
// RUTA PRINCIPAL (Catch-all) - SIEMPRE AL FINAL
// ==========================================
app.get('*', (req, res, next) => {
  const ext = path.extname(req.path);
  if (ext) {
    return next();
  }
  return res.sendFile(path.join(__dirname, 'frontend/index.html'));
});

// Manejo de cierres de conexión
process.on('exit', () => pool.end());
process.on('SIGINT', () => {
  pool.end(() => {
    console.log('Pool de conexiones cerrado.');
    process.exit(0);
  });
});

// ==========================================
// CEREBRO DE BOTANI (NVIDIA - NEMOTRON 3.5 - VERSIÓN FINAL)
// ==========================================
app.post('/api/chat', async (req, res) => {
  const { mensaje } = req.body;

  if (!mensaje) {
    return res.status(400).json({ error: "El mensaje está vacío" });
  }

  const promptSistema = `Eres Botani, un asistente virtual amigable y experto en botánica, especializado en la flora de Chiapas, México, y el Parque Los Cerritos. Perteneces al proyecto 'Flor Data' de la UNACH. Tus respuestas deben ser cálidas, entusiastas, claras y concisas (máximo 2 o 3 párrafos cortos). Usa emojis relacionados con plantas. No inventes datos que no sepas. 
    
    REGLA DE ORO ESTRICTA: NO incluyas tu proceso de pensamiento ("thinking process"). NO expliques cómo llegaste a la respuesta. Escribe DIRECTAMENTE y ÚNICAMENTE la respuesta final conversacional en español que leerá el usuario.`;

  try {
    console.log("Pensando la respuesta con NVIDIA (Nemotron 3.5)...");

    const respuestaNvidia = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', {
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      messages: [
        { role: "system", content: promptSistema },
        { role: "user", content: mensaje }
      ],
      temperature: 0.6,
      // ✨ ÚNICO CAMBIO: Subimos a 1000 para que termine de pensar y te dé tu respuesta final
      max_tokens: 10000
    }, {
      headers: {
        "Authorization": `Bearer ${process.env.NVIDIA_API_KEY_2}`,
        "Content-Type": "application/json"
      },
      timeout: 90000
    });

    const respuestaFinal = respuestaNvidia.data.choices[0].message.content;
    console.log("✅ ¡Botani respondió con éxito usando Nemotron!");

    res.json({ respuesta: respuestaFinal });

  } catch (error) {
    console.error("❌ Error en NVIDIA:", error.response ? error.response.data : error.message);
    res.status(500).json({ respuesta: "Uy, mis raíces digitales se enredaron un momento 🌿. Dame un minuto y vuelve a intentarlo." });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 5004;
const HOST = '192.168.1.69';

// Agregamos '0.0.0.0' para obligar al servidor a escuchar en toda tu red Wi-Fi
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor listo para el celular en: http://${HOST}:${PORT}`);
});