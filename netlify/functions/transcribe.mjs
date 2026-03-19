
import { GoogleGenerativeAI } from "@google/generative-ai";

const HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

export default async (req, context) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: HEADERS });
    }

    try {
        if (req.method !== "POST") {
            return new Response(JSON.stringify({ error: "Method Not Allowed" }), { 
                status: 405, 
                headers: { ...HEADERS, "Content-Type": "application/json" } 
            });
        }

        // 1. Parse JSON safely
        let audioData, mimeType;
        try {
            const body = await req.json();
            audioData = body.audioData;
            mimeType = body.mimeType;
        } catch (e) {
            return new Response(JSON.stringify({ error: "Invalid JSON input", details: e.message }), {
                status: 400,
                headers: { ...HEADERS, "Content-Type": "application/json" }
            });
        }

        if (!audioData) {
            return new Response(JSON.stringify({ error: "No audio data provided" }), {
                status: 400,
                headers: { ...HEADERS, "Content-Type": "application/json" }
            });
        }

        // 2. Get API Key safely (Try both prefixed and non-prefixed)
        const API_KEY = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

        if (!API_KEY) {
            console.error("[Backend] Missing API Key in environment variables.");
            return new Response(JSON.stringify({ error: "伺服器 API Key 未設定，請檢查 Netlify 設定。" }), {
                status: 500,
                headers: { ...HEADERS, "Content-Type": "application/json" }
            });
        }

        const genAI = new GoogleGenerativeAI(API_KEY);
        const modelName = "gemini-2.0-flash";
        const modelVersion = "v1beta";

        console.log(`[Backend] Analyzing: MIME=${mimeType}, Size=${Math.round(audioData.length/1024)}KB`);

        const model = genAI.getGenerativeModel(
            { model: modelName },
            { apiVersion: modelVersion }
        );

        const prompt = `你是專業的語音轉寫服務，負責為「表達力課程」產出高品質繁體中文逐字稿。請精確轉錄，修正口誤，保留重點內容。不要包含任何開場白或解釋。`;

        // 3. Call Gemini with timeout protection or simple await
        try {
            const result = await model.generateContent([
                { text: prompt },
                {
                    inlineData: {
                        data: audioData,
                        mimeType: mimeType || "audio/wav",
                    },
                },
            ]);

            const response = await result.response;
            const text = response.text().trim();

            if (!text) throw new Error("AI 回傳了空的內容");

            return new Response(JSON.stringify({ text }), {
                status: 200,
                headers: { ...HEADERS, "Content-Type": "application/json" }
            });
        } catch (geminiError) {
            console.error("[Gemini Error]", geminiError);
            return new Response(JSON.stringify({ 
                error: `Gemini 分析失敗: ${geminiError.message}`,
                details: geminiError.stack 
            }), {
                status: 500,
                headers: { ...HEADERS, "Content-Type": "application/json" }
            });
        }

    } catch (criticalError) {
        console.error("[Critical Backend Error]", criticalError);
        return new Response(JSON.stringify({
            error: "系統發生嚴重錯誤",
            details: criticalError.message
        }), {
            status: 500,
            headers: { ...HEADERS, "Content-Type": "application/json" }
        });
    }
};
