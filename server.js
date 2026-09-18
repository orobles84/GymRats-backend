import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Configuración de Multer para recibir la imagen/PDF en memoria
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // Hasta 15MB
});

// Inicialización de la API de Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Lista de modelos de respaldo en caso de alta demanda (Error 503 / 429)
const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-2.5-flash-lite'
];

const INBODY_PROMPT = `
Eres un experto en bioimpedancia clínica y análisis de composición corporal (InBody y SECA mBCA).
Examina la imagen adjunta del reporte de bioimpedancia y extrae con máxima precisión los siguientes valores numéricos.
Devuelve EXCLUSIVAMENTE un objeto JSON válido, sin bloques de código markdown, sin comillas invertidas y sin texto adicional:

{
  "user": "Nombre del evaluado o vacío si no se visualiza",
  "score": 0,          // Puntuación de Composición Corporal InBody / SECA (ej. 75)
  "peso": 0.0,         // Peso corporal en kg
  "mme": 0.0,          // Masa Músculo Esquelética en kg
  "grasaKg": 0.0,      // Masa Grasa Corporal en kg
  "imc": 0.0,          // Índice de Masa Corporal (kg/m²)
  "pgc": 0.0,          // Porcentaje de Grasa Corporal (%)
  "act": 0.0,          // Agua Corporal Total en Litros (TBW)
  "mcu": 0.0,          // Masa Libre de Grasa en kg (FFM)
  "tmb": 0,            // Tasa Metabólica Basal en kcal
  "gc": 0.0,           // Grasa Control recomendada (+ o - en kg)
  "mc": 0.0,           // Músculo Control recomendado (+ o - en kg)
  "pg": 0.0,           // Peso Objetivo sugerido
  "relacionCinturaCadera": 0.0, // RCC / WHR
  "minerales": 0.0,    // Minerales en kg
  "proteinas": 0.0,    // Proteínas en kg
  "brazoDer": 0.0,     // Masa magra segmental brazo derecho (kg)
  "brazoIzq": 0.0,     // Masa magra segmental brazo izquierdo (kg)
  "tronco": 0.0,       // Masa magra segmental tronco (kg)
  "piernaDer": 0.0,    // Masa magra segmental pierna derecha (kg)
  "piernaIzq": 0.0     // Masa magra segmental pierna izquierda (kg)
}

Reglas:
- Si un campo no está presente en el reporte, déjalo en 0.
- Devuelve solo el JSON plano.
`;

// Función con tolerancia a fallos: reintentos y cambio de modelo automático
async function analyzeWithGeminiWithFallback(imageBuffer, mimeType) {
  let lastError = null;

  for (const modelName of FALLBACK_MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[Gemini] Probando modelo: ${modelName} (Intento ${attempt})...`);
        
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: 'user',
              parts: [
                { text: INBODY_PROMPT },
                {
                  inlineData: {
                    mimeType: mimeType || 'image/jpeg',
                    data: imageBuffer.toString('base64')
                  }
                }
              ]
            }
          ]
        });

        const text = response.text?.trim() || '';
        const cleanJsonText = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
        const parsedData = JSON.parse(cleanJsonText);
        
        console.log(`[Gemini] Éxito con el modelo ${modelName}!`);
        return parsedData;

      } catch (err) {
        lastError = err;
        const errMsg = String(err.message || err);
        console.warn(`[Gemini Advertencia] Falló ${modelName} (Intento ${attempt}):`, errMsg);

        const is503OrRateLimit = errMsg.includes('503') || 
                                errMsg.toLowerCase().includes('high demand') || 
                                errMsg.includes('UNAVAILABLE') || 
                                errMsg.includes('429');

        if (is503OrRateLimit) {
          // Esperar 1.5 segundos antes de reintentar o saltar al siguiente modelo
          await new Promise(res => setTimeout(res, 1500));
        } else {
          // Si no es un error de sobrecarga, pasar al siguiente modelo
          break;
        }
      }
    }
  }

  throw lastError;
}

app.post('/api/scan-inbody', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se subió ninguna imagen o archivo' });
    }

    const data = await analyzeWithGeminiWithFallback(req.file.buffer, req.file.mimetype);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error al procesar InBody/SECA con Gemini:', error);
    
    const errText = String(error?.message || error);
    const is503 = errText.includes('503') || errText.toLowerCase().includes('high demand') || errText.includes('UNAVAILABLE');
    
    return res.status(is503 ? 503 : 500).json({
      success: false,
      error: is503 
        ? 'Los servidores de Google Gemini están experimentando alta demanda momentánea. Por favor reintenta en unos segundos.' 
        : (error.message || 'Error desconocido al analizar la hoja InBody')
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'gymrats-backend', version: '2026.09.7' });
});

app.listen(PORT, () => {
  console.log(`GymRats Backend escuchando en puerto ${PORT}`);
});
