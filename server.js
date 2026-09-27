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

// Configuración de Multer para recibir la imagen/PDF en memoria (hasta 25MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Inicialización de la API de Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Modelos modernos actualizados y 100% compatibles (2026)
const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.5-flash-lite'
];

const INBODY_PROMPT = `
Eres un especialista clínico en bioimpedancia médica y análisis de composición corporal.
Tu objetivo es examinar la imagen o reporte adjunto (reporte InBody de cualquier modelo como 120, 270, 370, 570, 770, o reporte SECA mBCA 514/515/525/554) y extraer con la más alta precisión clínica todos los datos del paciente y parámetros corporales.

Equivalencias y Mapeo:
- user: Nombre completo del evaluado / atleta / paciente si está visible en el reporte.
- date: Fecha de evaluación en formato YYYY-MM-DD si está visible.
- score: Puntuación de composición corporal InBody / SECA (0 a 100).
- peso: Peso total en kg (Weight).
- mme: Masa de Músculo Esquelético en kg (SMM / Skeletal Muscle Mass).
- grasaKg: Masa Grasa Corporal en kg (BFM / Body Fat Mass / Fat Mass).
- pgc: Porcentaje de Grasa Corporal en % (PBF / Fat %).
- imc: Índice de Masa Corporal en kg/m² (BMI).
- agua: Agua Corporal Total en Litros (TBW / Total Body Water / ACT).
- proteinas: Proteínas en kg.
- minerales: Minerales en kg.
- rcc: Relación Cintura-Cadera (WHR / Waist-Hip Ratio / RCC).
- visceral: Nivel de Grasa Visceral (VFL / Visceral Fat Level / VAT).
- tmb: Tasa Metabólica Basal en kcal (BMR).
- gc: Control de grasa recomendado (+ o - kg).
- mc: Control muscular recomendado (+ o - kg).
- pg: Peso objetivo recomendado en kg (Target Weight).
- magra_bi: Masa magra segmental Brazo Izquierdo (kg o "X.X kg / Y%").
- magra_bd: Masa magra segmental Brazo Derecho (kg o "X.X kg / Y%").
- magra_tr: Masa magra segmental Tronco (kg o "X.X kg / Y%").
- magra_pi: Masa magra segmental Pierna Izquierda (kg o "X.X kg / Y%").
- magra_pd: Masa magra segmental Pierna Derecha (kg o "X.X kg / Y%").
- grasa_bi: Grasa segmental Brazo Izquierdo (kg o "X.X kg / Y%").
- grasa_bd: Grasa segmental Brazo Derecho (kg o "X.X kg / Y%").
- grasa_tr: Grasa segmental Tronco (kg o "X.X kg / Y%").
- grasa_pi: Grasa segmental Pierna Izquierda (kg o "X.X kg / Y%").
- grasa_pd: Grasa segmental Pierna Derecha (kg o "X.X kg / Y%").

Si algún dato no aparece en el reporte, asigna 0 o cadena vacía según corresponda.
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

// Función con tolerancia a fallos: reintentos y cambio de modelo automático
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

        // Normalizar alias para compatibilidad total con todas las versiones de cliente
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
        
        console.log(`[Gemini] Éxito con el modelo ${modelName}! Atleta detectado: "${normalized.user || 'N/A'}"`);
        return normalized;

      } catch (err) {
        lastError = err;
        const errMsg = String(err.message || err);
        console.warn(`[Gemini Advertencia] Falló ${modelName} (Intento ${attempt}):`, errMsg);

        const is503OrRateLimit = errMsg.includes('503') || 
                                errMsg.toLowerCase().includes('high demand') || 
                                errMsg.includes('UNAVAILABLE') || 
                                errMsg.includes('429');

        if (is503OrRateLimit) {
          await new Promise(res => setTimeout(res, 1500));
        } else {
          // Si no es sobrecarga temporal, probar siguiente modelo
          break;
        }
      }
    }
  }

  throw lastError;
}

const EVALUATION_PROMPT = `
Eres un especialista clínico en bioimpedancia médica y entrenador deportivo de alto rendimiento.
Tu objetivo es analizar minuciosamente el historial cronológico de evaluaciones de composición corporal (InBody / SECA mBCA) de un atleta.
Compara la evolución desde la primera hasta la última evaluación registrada, determinando avances (ganancias musculares, pérdida de grasa, mejoras en grasa visceral y simetría) y retrocesos o riesgos clínicos (pérdida de masa magra, incremento de adiposidad o grasa visceral, desequilibrios segmentales).

Debes proporcionar:
1. athlete: Nombre del atleta evaluado.
2. periodCovered: Rango de fechas analizado (ej. "Del 12/01/2026 al 27/09/2026").
3. overallVerdict: Diagnóstico clínico deportivo general en 1 o 2 frases contundentes.
4. progressRating: Calificación numérica del avance global del 1 al 10.
5. statusBadge: Categoría breve del estado actual (ej. "Progreso Notable", "Recomposición Positiva", "Fase de Definición Exitosa", "Alerta de Pérdida Muscular", "Fase de Mantenimiento").
6. statusColor: Color temático para la interfaz ("green", "blue", "amber", o "rose").
7. summary: Análisis narrativo profesional detallando la tendencia observada en peso, músculo y grasa corporal.
8. avances: Lista (array) de logros y progresos cuantitativos demostrados con números.
9. retrocesos: Lista (array) de retrocesos, advertencias o puntos críticos a corregir. Si no hay, advertencias preventivas.
10. segmentalAnalysis: Evaluación de la simetría entre miembros superiores, inferiores y tronco.
11. nutritionalAdvice: Recomendaciones nutricionales específicas basadas en los resultados.
12. trainingAdvice: Pautas de entrenamiento de fuerza y sobrecarga progresiva.
13. nextGoal: Meta cuantitativa concreta y medible para la próxima evaluación InBody.
`;

const EVALUATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    athlete: { type: Type.STRING },
    periodCovered: { type: Type.STRING },
    overallVerdict: { type: Type.STRING },
    progressRating: { type: Type.NUMBER },
    statusBadge: { type: Type.STRING },
    statusColor: { type: Type.STRING },
    summary: { type: Type.STRING },
    avances: {
      type: Type.ARRAY,
      items: { type: Type.STRING }
    },
    retrocesos: {
      type: Type.ARRAY,
      items: { type: Type.STRING }
    },
    segmentalAnalysis: { type: Type.STRING },
    nutritionalAdvice: { type: Type.STRING },
    trainingAdvice: { type: Type.STRING },
    nextGoal: { type: Type.STRING }
  },
  required: [
    'athlete',
    'overallVerdict',
    'progressRating',
    'statusBadge',
    'statusColor',
    'summary',
    'avances',
    'retrocesos',
    'nutritionalAdvice',
    'trainingAdvice',
    'nextGoal'
  ]
};

async function evaluateAthleteProgressWithGemini(athlete, history) {
  const historyText = history.map((h, i) => {
    return `Evaluación #${i + 1} - Fecha: ${h.date || 'Desconocida'}
- Peso Corporal: ${h.peso ?? 0} kg
- Masa Muscular Esquelética (MME): ${h.mme ?? 0} kg
- Masa Grasa Corporal: ${h.grasaKg ?? 0} kg
- Porcentaje de Grasa (% PGC): ${h.pgc ?? 0}%
- Puntuación InBody: ${h.score ?? 0} / 100
- Nivel de Grasa Visceral: ${h.visceral ?? 'N/D'}
- IMC: ${h.imc ?? 'N/D'} kg/m²
- Agua Corporal Total: ${h.agua ?? h.act ?? 'N/D'} L
- Proteínas: ${h.proteinas ?? 'N/D'} kg
- Tasa Metabólica Basal (TMB): ${h.tmb ?? 'N/D'} kcal
- Masa Magra Segmental: Brazo Izq: ${h.segmentalMagra?.bi || 'N/D'}, Brazo Der: ${h.segmentalMagra?.bd || 'N/D'}, Tronco: ${h.segmentalMagra?.tr || 'N/D'}, Pierna Izq: ${h.segmentalMagra?.pi || 'N/D'}, Pierna Der: ${h.segmentalMagra?.pd || 'N/D'}
- Grasa Segmental: Brazo Izq: ${h.segmentalGrasa?.bi || 'N/D'}, Brazo Der: ${h.segmentalGrasa?.bd || 'N/D'}, Tronco: ${h.segmentalGrasa?.tr || 'N/D'}, Pierna Izq: ${h.segmentalGrasa?.pi || 'N/D'}, Pierna Der: ${h.segmentalGrasa?.pd || 'N/D'}`;
  }).join('\n\n');

  const promptContent = `
${EVALUATION_PROMPT}

DATOS DEL ATLETA:
Nombre: ${athlete}
Total de Evaluaciones: ${history.length}

HISTORIAL CRONOLÓGICO DE MEDICIONES:
${historyText}
`;

  let lastError = null;

  for (const modelName of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[Gemini Eval] Analizando progreso de ${athlete} con ${modelName} (Intento ${attempt})...`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: 'user',
              parts: [{ text: promptContent }]
            }
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: EVALUATION_SCHEMA
          }
        });

        const rawText = response.text?.trim() || '{}';
        return JSON.parse(rawText);
      } catch (err) {
        lastError = err;
        const msg = String(err?.message || err);
        console.warn(`[Gemini Eval] Falló ${modelName} (Intento ${attempt}):`, msg);

        const isTransient = msg.includes('503') || msg.toLowerCase().includes('high demand') || msg.includes('429');
        if (isTransient) {
          await new Promise((r) => setTimeout(r, 1500));
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
      return res.status(400).json({ success: false, error: 'No se subió ninguna imagen o archivo de reporte' });
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
        ? 'Los servidores de Google Gemini están experimentando alta demanda momentánea. Por favor reintenta en unos instantes.' 
        : (error.message || 'Error desconocido al analizar la hoja InBody')
    });
  }
});

app.post('/api/evaluate-inbody', async (req, res) => {
  try {
    const { athlete, history } = req.body;
    if (!athlete) {
      return res.status(400).json({ success: false, error: 'Se requiere el nombre del atleta para la evaluación.' });
    }
    if (!history || !Array.isArray(history) || history.length === 0) {
      return res.status(400).json({ success: false, error: 'No se proporcionaron registros históricos de evaluaciones InBody para analizar.' });
    }

    const evaluation = await evaluateAthleteProgressWithGemini(athlete, history);
    return res.json({ success: true, evaluation });
  } catch (error) {
    console.error('Error al generar evaluación de progreso con Gemini:', error);
    const errText = String(error?.message || error);
    const is503 = errText.includes('503') || errText.toLowerCase().includes('high demand') || errText.includes('UNAVAILABLE');
    return res.status(is503 ? 503 : 500).json({
      success: false,
      error: is503
        ? 'Los servidores de Google Gemini están experimentando alta demanda. Por favor intenta de nuevo en unos momentos.'
        : (error.message || 'Error al generar la evaluación clínica con IA')
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'gymrats-backend',
    version: '2026.09.9',
    models: GEMINI_MODELS
  });
});

app.listen(PORT, () => {
  console.log(`[GymRats Backend] Escuchando en puerto ${PORT}`);
});
