// server.js - GymRats Backend con Gemini AI Vision
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { GoogleGenAI, Type } from '@google/genai';
import 'dotenv/config';

const app = express();

// Configuración amplia de CORS para permitir peticiones desde GitHub Pages
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '20mb' }));

// Almacenamiento en memoria para no saturar el disco efímero de Render
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // Hasta 15MB
});

// Inicialización del cliente oficial de Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Esquema estructurado para la lectura de la hoja InBody
const inbodySchema = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.NUMBER, description: "Puntuación InBody total (ej. 79)" },
    peso: { type: Type.NUMBER, description: "Peso corporal total en kg" },
    mme: { type: Type.NUMBER, description: "Masa Músculo Esquelética MME en kg" },
    grasaKg: { type: Type.NUMBER, description: "Masa Grasa Corporal en kg" },
    pgc: { type: Type.NUMBER, description: "Porcentaje de Grasa Corporal PGC" },
    imc: { type: Type.NUMBER, description: "Índice de Masa Corporal IMC" },
    agua: { type: Type.NUMBER, description: "Agua Corporal Total en Litros" },
    proteinas: { type: Type.NUMBER, description: "Proteínas en kg" },
    minerales: { type: Type.NUMBER, description: "Minerales en kg" },
    rcc: { type: Type.NUMBER, description: "Relación Cintura-Cadera RCC" },
    visceral: { type: Type.NUMBER, description: "Nivel de Grasa Visceral" },
    tmb: { type: Type.NUMBER, description: "Tasa Metabólica Basal en kcal" },
    magra_bi: { type: Type.STRING, description: "Masa magra Brazo Izquierdo (ej: '3.42 kg / 109.4%')" },
    magra_bd: { type: Type.STRING, description: "Masa magra Brazo Derecho" },
    magra_tr: { type: Type.STRING, description: "Masa magra Tronco" },
    magra_pi: { type: Type.STRING, description: "Masa magra Pierna Izquierda" },
    magra_pd: { type: Type.STRING, description: "Masa magra Pierna Derecha" },
    grasa_bi: { type: Type.STRING, description: "Grasa Brazo Izquierdo" },
    grasa_bd: { type: Type.STRING, description: "Grasa Brazo Derecho" },
    grasa_tr: { type: Type.STRING, description: "Grasa Tronco" },
    grasa_pi: { type: Type.STRING, description: "Grasa Pierna Izquierda" },
    grasa_pd: { type: Type.STRING, description: "Grasa Pierna Derecha" }
  }
};

// Endpoint para verificar que el servidor está despierto (Healthcheck)
app.get('/', (req, res) => {
  res.json({ status: "OK", message: "Servidor GymRats activo y en línea" });
});

app.get('/api/health', (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Endpoint principal del escáner InBody
app.post('/api/scan-inbody', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No se subió ninguna imagen" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ 
        success: false, 
        error: "Falta la variable GEMINI_API_KEY en el entorno de Render." 
      });
    }

    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype || "image/jpeg";

    // Usamos el modelo gemini-3.6-flash solicitado por Google
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: [
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Image
          }
        },
        {
          text: "Analiza detalladamente esta fotografía de una hoja de evaluación de composición corporal InBody. " +
                "Extrae con la máxima precisión todos los valores numéricos correspondientes al peso, músculo, grasa, agua, " +
                "minerales, masa magra segmental y grasa segmental. Si un campo no es visible o está tapado, déjalo vacío o en 0."
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: inbodySchema
      }
    });

    // Limpieza de posibles bloques markdown que pueda emitir la IA
    const rawText = response.text ? response.text.trim() : "";
    const cleanJsonText = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    const datosInBody = JSON.parse(cleanJsonText);

    res.json({ success: true, data: datosInBody });
  } catch (error) {
    console.error("Error al procesar con Gemini:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message || "Error interno al procesar la imagen con Gemini AI" 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor Gemini InBody corriendo exitosamente en el puerto ${PORT}`);
});
