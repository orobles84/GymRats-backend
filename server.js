const express = require('express');
const cors = require('cors');

const app = express();

// Habilitar CORS para permitir peticiones desde tu frontend
app.use(cors());
app.use(express.json());

// Ruta de prueba de salud del servidor
app.get('/', (req, res) => {
  res.send('Backend de GymRats activo y funcionando correctamente');
});

// Endpoint del escáner InBody
app.post('/api/inbody/scan', (req, res) => {
  try {
    const { userId } = req.body;

    // Simulación de respuesta de escaneo de InBody
    const inbodyData = {
      timestamp: new Date().toISOString(),
      peso: 75.4,
      masaMuscular: 36.2,
      porcentajeGrasa: 14.8,
      aguaCorporal: 48.1,
      status: 'Escaneo exitoso'
    };

    res.status(200).json({
      success: true,
      message: 'Escaneo InBody completado exitosamente',
      data: inbodyData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al procesar el escaneo InBody',
      error: error.message
    });
  }
});

// Asignación de puerto dinámica requerida por Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor de GymRats corriendo en el puerto ${PORT}`);
});
