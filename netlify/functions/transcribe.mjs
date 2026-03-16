
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

    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: HEADERS });
    }

    try {
        const { audioData, mimeType } = await req.json();

        if (!audioData) {
            return new Response(JSON.stringify({ error: "No audio data provided" }), {
                status: 400,
                headers: { ...HEADERS, "Content-Type": "application/json" }
            });
        }

        // Get API Key from environment variable (Netlify dashboard)
        const API_KEY = process.env.VITE_GEMINI_API_KEY;

        const genAI = new GoogleGenerativeAI(API_KEY);

        // Prioritize models as per plan
        const modelName = "gemini-2.0-flash"; // Restored higher performance model
        const modelVersion = "v1beta";

        console.log(`[Backend] Processing audio with ${modelName} (${modelVersion})...`);

        const model = genAI.getGenerativeModel(
            { model: modelName },
            { apiVersion: modelVersion }
        );

        const prompt = `
        你是專業的語音轉寫服務，負責為「表達力課程」產出高品質逐字稿。
        
        任務目標：
        1. 聽這段音訊，並輸出精確、穩定的繁體中文逐字稿。
        2. 這是學員的練習錄音，可能包含自然的停頓、思考內容或重複。
        
        嚴格準則 (不遵守會導致分析錯誤)：
        - 忠於原意：保持說話者原本的原意，不要隨意總結或刪除重點。
        - 處理雜訊與幻覺：如果音訊太小聲、雜訊過大或聽不清，請直接輸出 [聽不清] 或保持該段落空白。千萬不要試圖從雜訊中「腦補」或「幻想」出語法正確但不存在的文字。
        - 修正輕微口誤：僅修正明顯的碎詞 (如：呃、然後然後、那個...)，但保留表達的核心內容。
        - 標點分段：根據語意加上正確的標點符號與分段。
        
        輸出格式：
        - 僅輸出逐字稿內容，不要包含任何開場白或解釋。
    `;

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

        if (!text) {
            throw new Error("Gemini returned empty text");
        }

        return new Response(JSON.stringify({ text }), {
            status: 200,
            headers: { ...HEADERS, "Content-Type": "application/json" }
        });

    } catch (error) {
        console.error("[Backend Error]", error);

        return new Response(JSON.stringify({
            error: error.message || "Unknown backend error",
            details: error.stack
        }), {
            status: 500,
            headers: { ...HEADERS, "Content-Type": "application/json" }
        });
    }
};
