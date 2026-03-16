import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function (req, res) {
    console.log("[VERCEL] API STARTING (V4-ESM) - AT: " + new Date().toISOString());

    // CORS Headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { audioData, mimeType } = req.body;

        if (!audioData) {
            console.error("[VERCEL] Error: No audioData in request body");
            return res.status(400).json({ error: "No audio data provided" });
        }

        const API_KEY = process.env.VITE_GEMINI_API_KEY;
        if (!API_KEY) {
            console.error("[VERCEL] Error: VITE_GEMINI_API_KEY env var is missing");
            return res.status(500).json({ error: "Server Configuration Error: API Key Missing" });
        }

        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        console.log("[VERCEL] Calling Gemini...");
        const result = await model.generateContent([
            {
                text: `你是專業的語音轉寫服務，負責為「表達力課程」產出高品質逐字稿。
        
        任務目標：
        1. 聽這段音訊，並輸出精確、穩定的繁體中文逐字稿。
        2. 這是學員的練習錄音，可能包含自然的停頓、思考內容或重複。
        
        嚴格準則 (不遵守會導致分析錯誤)：
        - 忠於原意：保持說話者原本的原意，不要隨意總結或刪除重點。
        - 處理雜訊與幻覺：如果音訊太小聲、雜訊過大或聽不清，請直接輸出 [聽不清] 或保持該段落空白。千萬不要試圖從雜訊中「腦補」或「幻想」出語法正確但不存在的文字。
        - 修正輕微口誤：僅修正明顯的碎詞 (如：呃、然後然後、那個...)，但保留表達的核心內容。
        - 標點分段：根據語意加上正確的標點符號與分段。
        
        輸出格式：
        - 僅輸出逐字稿內容，不要包含任何開場白或解釋。` },
            {
                inlineData: {
                    data: audioData,
                    mimeType: mimeType || "audio/wav",
                },
            },
        ]);

        const response = await result.response;
        const text = response.text().trim();

        if (!text) throw new Error("Empty response from AI");

        console.log("[VERCEL] Success!");
        return res.status(200).json({ text });

    } catch (e) {
        console.error("[VERCEL CRASH]", e);
        return res.status(500).json({
            error: e.message,
            details: e.stack,
            version: "V4-ESM-CRASH"
        });
    }
}
