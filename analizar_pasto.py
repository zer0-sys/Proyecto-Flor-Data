import sys
import cv2
import numpy as np
import json

def calcular_vegetacion(ruta_imagen):
    try:
        # Leer la imagen original
        imagen = cv2.imread(ruta_imagen)
        if imagen is None:
            print(json.dumps({"porcentaje": "0.00", "imagen": "", "hojas": "0"}))
            return

        alto, ancho = imagen.shape[:2]
        area_total = alto * ancho

        # Convertir a espectro de color HSV
        hsv = cv2.cvtColor(imagen, cv2.COLOR_BGR2HSV)
        
        # Definir qué es "Verde" (Vegetación general)
        rango_bajo = np.array([30, 40, 40])
        rango_alto = np.array([90, 255, 255])
        
        # Crear la máscara de todo lo verde sin importar el ángulo
        mascara = cv2.inRange(hsv, rango_bajo, rango_alto)

        # Calcular el porcentaje exacto de toda la vegetación
        pixeles_verdes = cv2.countNonZero(mascara)
        porcentaje = (pixeles_verdes / area_total) * 100

        # Estimación matemática general de hojas/biomasa
        hojas_estimadas = int(pixeles_verdes / 18)
        hojas_texto = f"{hojas_estimadas:,}" 

        # --- CREAR LA CAPA ROJA TRANSPARENTE ---
        capa_roja = np.zeros_like(imagen, np.uint8)
        capa_roja[:] = (0, 0, 255) # Color Rojo
        
        rojo_recortado = cv2.bitwise_and(capa_roja, capa_roja, mask=mascara)
        imagen_final = cv2.addWeighted(imagen, 1.0, rojo_recortado, 0.5, 0)

        # Guardar la foto procesada
        ruta_salida = ruta_imagen + "_mask.jpg"
        cv2.imwrite(ruta_salida, imagen_final)

        ruta_web = ruta_salida.replace("\\", "/")
        print(json.dumps({
            "porcentaje": f"{porcentaje:.2f}", 
            "imagen": ruta_web,
            "hojas": hojas_texto
        }))

    except Exception as e:
        print(json.dumps({"porcentaje": "0.00", "imagen": "", "hojas": "0"}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        calcular_vegetacion(sys.argv[1])
    else:
        print(json.dumps({"porcentaje": "0.00", "imagen": "", "hojas": "0"}))