#!/bin/bash

# Matar procesos en el puerto 5004 si existen
echo "Matando procesos en puerto 5004..."
lsof -ti:5004 | xargs kill -9 2>/dev/null || true

# Esperar un segundo
sleep 1

# Iniciar el servidor
echo "Iniciando servidor..."
node server.js