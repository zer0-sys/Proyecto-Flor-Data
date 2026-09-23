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





// ==========================================
// RUTA SECRETA PARA POBLAR HASHES VACÍOS
// ==========================================
app.get('/admin/generar-hashes', async (req, res) => {
    try {
        // 👇 CAMBIA "imagen_url" POR EL NOMBRE REAL DE TU COLUMNA EN SUPABASE
        const nombreColumnaImagen = 'imagen'; 
        
        const dbResult = await pool.query(`SELECT id, ${nombreColumnaImagen} FROM plantas WHERE hash_foto IS NULL`);
        const plantas = dbResult.rows;

        if (!plantas || plantas.length === 0) {
            return res.send("✅ Todas las plantas de la biblioteca ya tienen su hash.");
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.write(`Se encontraron ${plantas.length} plantas sin hash. Procesando...\n\n`);

        for (let planta of plantas) {
            // Evaluamos usando la variable dinámica
            const linkImagen = planta[nombreColumnaImagen];

            if (linkImagen) {
                try {
                    const respuesta = await axios.get(linkImagen, { responseType: 'arraybuffer' });
                    const bufferImagen = Buffer.from(respuesta.data, 'binary');

                    const hashCalculado = crypto.createHash('md5').update(bufferImagen).digest('hex');

                    await pool.query("UPDATE plantas SET hash_foto = $1 WHERE id = $2", [hashCalculado, planta.id]);

                    res.write(`✅ ID ${planta.id} -> ${hashCalculado}\n`);
                } catch (errFoto) {
                    res.write(`❌ Error en ID ${planta.id}: ${errFoto.message}\n`);
                }
            } else {
                // Si la columna está vacía o el nombre es incorrecto, te lo dirá aquí:
                res.write(`⚠️ ID ${planta.id} omitido: No se encontró un enlace en la columna '${nombreColumnaImagen}'\n`);
            }
        }

        res.end("\n🎉 ¡Proceso terminado!");
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
    const imageDataUrl = "data:image/jpeg;base64," + imageBase64;
    let nombrePlanta = "DESCONOCIDO";
    let nombreComunBusqueda = "DESCONOCIDO";
    let nombreCientificoBusqueda = "DESCONOCIDO";

    // ==========================================
    // NIVEL 2: CARRERA DE IAs GRATUITAS (Ejecución en paralelo)
    // ==========================================
    try {
      console.log("Iniciando carrera de IAs (NVIDIA vs Groq)...");

      const promptExperto = "Eres un botánico experto. Analiza esta imagen. Si la reconoces con seguridad, responde OBLIGATORIAMENTE en este formato exacto: Nombre Común|Nombre Científico (ejemplo: Palma Areca|Dypsis lutescens). Si tienes dudas, responde: DESCONOCIDO. No saludes ni des explicaciones, solo el formato indicado."; 
      const mensajesIA = [{
        role: "user",
        content: [
          { type: "text", text: promptExperto },
          { type: "image_url", image_url: { url: imageDataUrl } }
        ]
      }];

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

        if (resultado.includes("DESCONOCIDO")) {
          throw new Error(`${nombre} no supo la respuesta.`);
        }

        console.log(`🏆 ¡Ganador de la carrera! ${nombre} respondió primero con: ${resultado}`);
        return resultado;
      };

      nombrePlanta = await Promise.any([
        lanzarCompetidor("NVIDIA (Llama 90b)", 'https://integrate.api.nvidia.com/v1/chat/completions', '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', 'meta/llama-3.2-90b-vision-instruct'),
        lanzarCompetidor("NVIDIA (Llama 11b rápida)", 'https://integrate.api.nvidia.com/v1/chat/completions', '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', 'meta/llama-3.2-11b-vision-instruct'),
        lanzarCompetidor("Groq (Llama 90b)", 'https://api.groq.com/openai/v1/chat/completions', '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', 'llama-3.2-90b-vision-preview')
      ]);

      console.log("IA ganadora identificó: " + nombrePlanta);

      if (nombrePlanta.includes('|')) {
        const partes = nombrePlanta.split('|');
        nombreComunBusqueda = partes[0].replace(/[.,]/g, '').trim();
        nombreCientificoBusqueda = partes[1].replace(/[.,]/g, '').trim();
        nombrePlanta = nombreComunBusqueda; 
      } else {
        nombrePlanta = nombrePlanta.replace(/[.,]/g, '').trim();
        nombreComunBusqueda = nombrePlanta;
        nombreCientificoBusqueda = nombrePlanta;
      }

    } catch (carreraError) {
      console.log("Ninguna IA gratuita logró identificarla a tiempo o con seguridad. Pasando a Plant.id...");
      nombrePlanta = "DESCONOCIDO";
    }

    // ==========================================
    // NIVEL 3: LABORATORIO DE PAGA (PLANT.ID - FALLBACK)
    // ==========================================
    if (nombrePlanta.toUpperCase().includes("DESCONOCIDO")) {
      console.log("NVIDIA no está seguro. Llamando a Plant.id...");
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
            'Api-Key': llaveDelUsuario, 
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
    // LÓGICA DE BASE DE DATOS Y CENSO CORREGIDA 
    // ==========================================
    const { latitud, longitud, zona } = req.body;
    const zonaPlanta = zona || 'General';

    // 1. Buscamos en el censo
    const queryCenso = "SELECT * FROM registro_censo WHERE (nombre_identificado ILIKE $1 OR nombre_identificado ILIKE $2) AND (hash_foto = $3 OR (ABS(latitud - $4::numeric) < 0.0001 AND ABS(longitud - $5::numeric) < 0.0001)) LIMIT 1";
    const dbResultCenso = await pool.query(queryCenso, ["%" + nombreComunBusqueda + "%", "%" + nombreCientificoBusqueda + "%", hashFoto, latitud, longitud]);

    // 2. Buscamos en la biblioteca local
    let queryBiblioteca = 'SELECT * FROM plantas WHERE nombreComun ILIKE $1 OR nombreCientifico ILIKE $1 OR nombreComun ILIKE $2 OR nombreCientifico ILIKE $2 LIMIT 1';
    const busquedaNormal = await pool.query(queryBiblioteca, ["%" + nombreComunBusqueda + "%", "%" + nombreCientificoBusqueda + "%"]);

    // 3. Verificamos si realmente existe en la biblioteca
    const estaEnBiblioteca = busquedaNormal.rows.length > 0;
    const datosBiblioteca = estaEnBiblioteca ? busquedaNormal.rows[0] : null;

    if (dbResultCenso.rows.length > 0) {
      // Ya estaba en el censo
      res.json({
        encontrado: estaEnBiblioteca, // true solo si está en tu biblioteca local
        datos: datosBiblioteca,
        nombreSugerido: nombrePlanta, // <-- EL SALVAVIDAS: siempre mandamos el nombre
        porcentajePasto: porcentajePasto,
        imagenMascara: imagenMascara,
        hojasEstimadas: hojasEstimadas,
        zonaUbicacion: zonaPlanta,
        mensaje: estaEnBiblioteca 
            ? "¡Excelente! Ejemplar ya existente en el censo identificado con éxito."
            : "Ejemplar ya en censo, pero sin detalles en la biblioteca local."
      });
    } else {
      // Es nueva, hay que insertarla en el censo
      if (latitud && longitud) {
        try {
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

      // Respuesta al frontend
      res.json({
        encontrado: estaEnBiblioteca, // true solo si está en tu biblioteca local
        datos: datosBiblioteca,
        nombreSugerido: nombrePlanta, // <-- EL SALVAVIDAS
        porcentajePasto: porcentajePasto,
        imagenMascara: imagenMascara,
        hojasEstimadas: hojasEstimadas, 
        zonaUbicacion: zonaPlanta,
        mensaje: estaEnBiblioteca 
            ? "¡Excelente! Has registrado un nuevo ejemplar para el censo."
            : "Identificada como: " + nombrePlanta + ". (Nueva en el censo, pero no en biblioteca)."
      });
    }

    // Limpieza de foto temporal
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
  // Imprimimos qué está llegando realmente desde el frontend
  console.log("📡 Datos recibidos en /api/ranking:", req.body);

  const { nombre_equipo, equipo, nombre, puntaje, zona, integrantes, integrantes_del_equipo } = req.body;
  
  try {
    if (puntaje === 0) {
      return res.json({ exito: true, mensaje: 'Puntaje 0 omitido.' });
    }

    // Buscamos el nombre del equipo en varias posibles variables que tu frontend pueda estar mandando
    let equipoCapturado = nombre_equipo || equipo || nombre || "";
    
    const equipoFinal = (equipoCapturado.trim() !== '') ? equipoCapturado.trim() : 'Equipo Explorador';
    const zonaFinal = (zona && zona.trim() !== '') ? zona.trim() : 'Los Cerritos';
    const numIntegrantes = parseInt(integrantes || integrantes_del_equipo || 1);

    if (equipoFinal === 'Equipo Explorador') {
        console.warn("⚠️ ATENCIÓN: El frontend envió el nombre vacío o nulo. Se usó el valor por defecto 'Equipo Explorador'.");
    }

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
// CEREBRO DE BOTANI (SISTEMA DE RESPALDO: MISTRAL -> LLAMA -> NEMOTRON)
// ==========================================
app.post('/api/chat', async (req, res) => {
  const { mensaje } = req.body;

  if (!mensaje) {
    return res.status(400).json({ error: "El mensaje está vacío" });
  }

  const promptSistema = `Eres Botani, un asistente virtual amigable y experto en botánica, especializado en la flora de Chiapas, México, y el Parque Los Cerritos. Perteneces al proyecto 'Flor Data' de la UNACH. Tus respuestas deben ser cálidas, entusiastas, claras y concisas (máximo 2 o 3 párrafos cortos). Usa emojis relacionados con plantas. No inventes datos que no sepas. 
    
    REGLAS DE ORO ESTRICTAS: 
    1. NO incluyas tu proceso de pensamiento ("thinking process"). NO expliques cómo llegaste a la respuesta. Escribe DIRECTAMENTE la respuesta final.
    2. FILTRADO: Si te preguntan por características específicas (ej. plantas con espinas, frutos), NO listes todas las plantas que conoces. Filtra y menciona SOLO las que cumplen la condición.
    3. FORMATO: Obedece estrictamente si el usuario te pide un resumen de un solo párrafo, sin usar viñetas.`;

  // Base de la petición que comparten todos los modelos
  const datosBase = {
    messages: [
      { role: "system", content: promptSistema },
      { role: "user", content: mensaje }
    ],
    temperature: 0.6,
    max_tokens: 1024
  };

  // Lista de IAs en orden de prioridad. 
  // Ajusté las variables de entorno según tu indicación (apiKey 3 y apiKey 2)
  const modelosAProbar = [
    { 
      nombre: "Mistral", 
      modeloId: "mistralai/mistral-nemotron-2408", 
      apiKey: process.env.NVIDIA_API_KEY_3 
    },
    { 
      nombre: "Llama 3.2 (11B)", 
      modeloId: "meta/llama-3.2-11b-vision-instruct", 
      apiKey: process.env.NVIDIA_API_KEY_2 
    },
    { 
      nombre: "Nemotron 3.5", 
      modeloId: "nvidia/nemotron-3.5-lightning-30b-a3b", 
      apiKey: process.env.NVIDIA_API_KEY_1 // Asumiendo que esta es tu primera clave original
    }
  ];

  let respuestaFinal = null;

  for (const ia of modelosAProbar) {
    try {
      console.log(`🧠 Intentando pensar con: ${ia.nombre}...`);

      const respuesta = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', {
        model: ia.modeloId,
        ...datosBase
      }, {
        headers: {
          "Authorization": `Bearer ${ia.apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 90000 // 15 segundos máximo por IA para evitar que la web se quede colgada
      });

      respuestaFinal = respuesta.data.choices[0].message.content;
      console.log(`✅ ¡${ia.nombre} respondió con éxito!`);
      break; 

    } catch (error) {
      console.error(`⚠️ ${ia.nombre} falló:`, error.response ? error.response.data : error.message);
    }
  }

  if (respuestaFinal) {
    res.json({ respuesta: respuestaFinal });
  } else {
    console.error("❌ Todas las IAs fallaron.");
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