const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function listarModelos() {
    try {
        const models = await genAI.listModels();
        console.log("Modelos disponibles para tu cuenta:");
        models.models.forEach(m => console.log("- " + m.name));
    } catch (err) {
        console.error("Error al listar modelos:", err);
    }
}
listarModelos();