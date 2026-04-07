import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();

// ✅ 1. SECURE CORS CONFIGURATION
const allowedOrigins = [
  "https://planora-9084f.web.app", // Your live Firebase site
  "http://localhost:5173",          // Your local Vite development
  "http://localhost:3000"           // Alternative local port
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS policy"));
    }
  },
  methods: ["GET", "POST"],
  credentials: true
}));

app.use(express.json());

// ✅ 2. HEALTH CHECK ROUTE
app.get("/", (req, res) => {
  res.send("Planora Backend is Live 🚀");
});

// ✅ 3. GEMINI SETUP
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ 4. GENERATE FLOOR PLAN API
app.post("/generate-plan", async (req, res) => {
  try {
    const { houseType, style, familySize, bedrooms } = req.body;

    // Use the 2026 stable model
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });

    const prompt = `
      Generate a detailed floor plan for a ${houseType} in ${style} style for ${familySize} people with ${bedrooms} bedrooms.
      
      Return ONLY a raw JSON object. Do not include markdown backticks or the word "json".
      Structure:
      {
        "floors": [
          { "name": "Floor Name", "rooms": ["Room A", "Room B"] }
        ]
      }
    `;

    const result = await model.generateContent(prompt);
    let text = result.response.text();

    // 🧼 Advanced Sanitization: Catch markdown or leading/trailing text
    const cleanJson = text.replace(/```json|```/g, "").trim();

    try {
      const parsed = JSON.parse(cleanJson);
      res.json({ output: parsed });
    } catch (parseError) {
      console.error("JSON Parse Error. Raw text was:", text);
      res.status(500).json({ 
        error: "AI returned invalid formatting", 
        details: "The model failed to provide pure JSON." 
      });
    }

  } catch (err) {
    console.error("BACKEND ERROR:", err);
    res.status(500).json({
      error: "Gemini API Connection Failed",
      details: err.message
    });
  }
});

// ✅ 5. PRODUCTION PORT LOGIC
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});