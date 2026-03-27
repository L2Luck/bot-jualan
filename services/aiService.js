const { GoogleGenerativeAI } = require('@google/generative-ai');

function createAIService(apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);

    async function jawabPertanyaanToko(pertanyaan) {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const promptAI = `Kamu adalah Customer Service ramah untuk "Toko Kami". Jawab pertanyaan pelanggan ini dengan singkat, sopan, dan dalam bahasa Indonesia. Pertanyaan: ${pertanyaan}`;
        const result = await model.generateContent(promptAI);
        return result.response.text();
    }

    return {
        jawabPertanyaanToko
    };
}

module.exports = {
    createAIService
};
