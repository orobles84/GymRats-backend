// server.js
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { GoogleGenAI, Type } from '@google/genai';

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Esquema estructurado para forzar la lectura exacta de la hoja InBody
const inbodySchema = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.NUMBER, description: "Puntuación InBody total" },
    peso: { type: Type.NUMBER, description: "Peso corporal total en kg" },
    mme: { type: Type.NUMBER, description: "Masa Músculo Esquelética MME en kg" },
    grasaKg: { type: Type.NUMBER, description: "Masa Grasa Corporal en kg" },
    pgc: { type: Type.NUMBER, description: "Porcentaje de Grasa Corporal PGC" },
    imc: { type: Type.NUMBER, description: "Índice de Masa Corporal IMC" },
    agua: { type: Type.NUMBER, description: "Agua Corporal Total en Litros" },
    proteinas: { type: Type.NUMBER, description: "Proteínas en kg" },
    minerales: { type: Type.NUMBER, description: "Minerales en kg" },
    rcc: { type: Type.NUMBER, description: "Relación Cintura-Cadera" },
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
  },
  required: ["score", "peso", "mme", "grasaKg", "pgc"]
};

app.post('/api/scan-inbody', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No se subió ninguna imagen" });

    const base64Image = req.file.buffer.toString("base64");

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [
        {
          inlineData: {
            mimeType: req.file.mimetype,
            data: base64Image
          }
        },
        {
          text: "Extrae de forma precisa todos los valores numéricos y segmentales de esta ficha de resultados InBody. Mapea cada valor según la estructura requerida."
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: inbodySchema,
        temperature: 0.0
      }
    });

    const datosInBody = JSON.parse(response.text);
    res.json({ success: true, data: datosInBody });
  } catch (error) {
    console.error("Error al procesar con Gemini:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor Gemini InBody corriendo en puerto ${PORT}`));
