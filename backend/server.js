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

        // ✅ KEY CHANGE: Add generationConfig to force JSON output
        const model = genAI.getGenerativeModel({
            model: "gemini-3-flash", // Using the 2026 flagship model
            generationConfig: {
                responseMimeType: "application/json"
            }
        });

        const prompt = `Generate a structural floor plan for a ${houseType} in ${style} style for a family of ${familySize} with ${bedrooms} bedrooms. 
        Output MUST be a JSON object with this exact structure:
        {
          "projectTitle": "String",
          "totalArea": "String",
          "floors": [
            {
              "floorName": "String",
              "rooms": [
                {"name": "String", "dimensions": "String", "description": "String"}
              ]
            }
          ],
          "architecturalAdvice": "String"
        }`;

        const result = await model.generateContent(prompt);
        let text = result.response.text();

        // 🧼 Sanitization remains as a safety net
        const cleanJson = text.replace(/```json|```/g, "").trim();

        try {
            const parsed = JSON.parse(cleanJson);
            // ✅ We send 'parsed' back. Your frontend should look for data.output
            res.json({ output: parsed });
        } catch (parseError) {
            console.error("JSON Parse Error:", text);
            res.status(500).json({ error: "AI returned invalid formatting" });
        }

    } catch (err) {
        console.error("BACKEND ERROR:", err);
        res.status(500).json({ error: "Connection Failed", details: err.message });
    }
});
// ✅ 5. PRODUCTION PORT LOGIC
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});