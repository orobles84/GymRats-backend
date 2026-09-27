import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '25mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Modelos actualizados compatibles
const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.5-flash-lite'
];

const INBODY_PROMPT = `
Eres un especialista clínico en bioimpedancia médica y análisis de composición corporal.
Examina la imagen o página adjunta del reporte (InBody 120/270/370/570/770 o SECA mBCA 514/515/525/554) y extrae los datos numéricos del paciente.

Equivalencias:
- user: Nombre completo del paciente/atleta si está presente.
- date: Fecha de evaluación en formato YYYY-MM-DD si está presente.
- score: Puntuación de composición corporal InBody / SECA (0 a 100).
- peso: Peso en kg.
- mme: Masa Músculo Esquelética en kg (SMM).
- grasaKg: Masa Grasa Corporal en kg (BFM).
- pgc: Porcentaje de Grasa Corporal en % (PBF).
- imc: Índice de Masa Corporal (BMI).
- agua: Agua Corporal Total en Litros (TBW).
- proteinas: Proteínas en kg.
- minerales: Minerales en kg.
- rcc: Relación Cintura-Cadera (WHR).
- visceral: Grasa Visceral (VFL/VAT).
- tmb: Tasa Metabólica Basal en kcal.
- gc: Control de grasa recomendado (kg).
- mc: Control muscular recomendado (kg).
- pg: Peso objetivo (kg).
- magra_bi, magra_bd, magra_tr, magra_pi, magra_pd: Masa magra segmental.
- grasa_bi, grasa_bd, grasa_tr, grasa_pi, grasa_pd: Grasa segmental.
`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    user: { type: Type.STRING },
    date: { type: Type.STRING },
    score: { type: Type.NUMBER },
    peso: { type: Type.NUMBER },
    mme: { type: Type.NUMBER },
    grasaKg: { type: Type.NUMBER },
    pgc: { type: Type.NUMBER },
    imc: { type: Type.NUMBER },
    agua: { type: Type.NUMBER },
    proteinas: { type: Type.NUMBER },
    minerales: { type: Type.NUMBER },
    rcc: { type: Type.NUMBER },
    visceral: { type: Type.NUMBER },
    tmb: { type: Type.NUMBER },
    gc: { type: Type.NUMBER },
    mc: { type: Type.NUMBER },
    pg: { type: Type.NUMBER },
    magra_bi: { type: Type.STRING },
    magra_bd: { type: Type.STRING },
    magra_tr: { type: Type.STRING },
    magra_pi: { type: Type.STRING },
    magra_pd: { type: Type.STRING },
    grasa_bi: { type: Type.STRING },
    grasa_bd: { type: Type.STRING },
    grasa_tr: { type: Type.STRING },
    grasa_pi: { type: Type.STRING },
    grasa_pd: { type: Type.STRING }
  },
  required: ['peso', 'mme', 'grasaKg', 'pgc', 'imc']
};

async function analyzeWithGeminiWithFallback(imageBuffer, mimeType) {
  let lastError = null;

  for (const modelName of GEMINI_MODELS) {
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
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA
          }
        });

        const rawText = response.text?.trim() || '{}';
        const parsedData = JSON.parse(rawText);

        const normalized = {
          ...parsedData,
          act: parsedData.agua ?? 0,
          relacionCinturaCadera: parsedData.rcc ?? 0,
          brazoDer: parseFloat(parsedData.magra_bd) || 0,
          brazoIzq: parseFloat(parsedData.magra_bi) || 0,
          tronco: parseFloat(parsedData.magra_tr) || 0,
          piernaDer: parseFloat(parsedData.magra_pd) || 0,
          piernaIzq: parseFloat(parsedData.magra_pi) || 0
        };

        return normalized;
      } catch (err) {
        lastError = err;
        const errMsg = String(err.message || err);
        console.warn(`[Gemini] Falló ${modelName} (Intento ${attempt}):`, errMsg);

        const is503 = errMsg.includes('503') || errMsg.toLowerCase().includes('high demand') || errMsg.includes('429');
        if (is503) {
          await new Promise(res => setTimeout(res, 1500));
        } else {
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
    console.error('Error al procesar InBody/SECA:', error);
    const errText = String(error?.message || error);
    const is503 = errText.includes('503') || errText.toLowerCase().includes('high demand');
    return res.status(is503 ? 503 : 500).json({
      success: false,
      error: is503 
        ? 'Los servidores de Google Gemini tienen alta demanda momentánea. Por favor reintenta en unos segundos.' 
        : (error.message || 'Error al analizar la hoja InBody')
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'gymrats-backend', version: '2026.09.9' });
});

app.listen(PORT, () => {
  console.log(`GymRats Backend escuchando en puerto ${PORT}`);
});
