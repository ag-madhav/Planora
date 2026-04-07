import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Health check route
app.get("/", (req, res) => {
  console.log("GET / hit");
  res.send("Backend is running 🚀");
});

// ✅ Gemini setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ Generate Floor Plan API
app.post("/generate-plan", async (req, res) => {
  try {
    const { houseType, style, familySize, bedrooms } = req.body;

    // 🔥 Better prompt (forces structured output)
    const prompt = `
Generate a detailed floor plan in STRICT JSON format.

House Type: ${houseType}
Style: ${style}
Family Size: ${familySize}
Bedrooms: ${bedrooms}

Rules:
- Output ONLY valid JSON
- No explanation, no markdown
- Include multiple floors if needed (villa, duplex, etc.)

Format:
{
  "floors": [
    {
      "name": "Ground Floor",
      "rooms": ["Living Room", "Kitchen", "Dining"]
    }
  ]
}
`;

    // ✅ Use working model
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });

    const result = await model.generateContent(prompt);

    let text = result.response.text();

    // 🧼 Clean markdown if present
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    // ✅ Parse JSON safely
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      console.error("JSON Parse Error:", text);
      return res.status(500).json({
        error: "Invalid JSON returned by AI",
        raw: text,
      });
    }

    res.json({ output: parsed });
  } catch (err) {
    console.error("FULL ERROR:", err);
    res.status(500).json({
      error: err.message || "Something went wrong",
    });
  }
});

// ✅ Start server
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});