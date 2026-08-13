const { GoogleGenAI } = require("@google/genai");
require("dotenv").config({ path: ".env" });
async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.list();
  for await (const m of response) {
    if (m.name.includes("gemini")) console.log(m.name);
  }
}
run();
