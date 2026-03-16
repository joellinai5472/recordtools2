
/**
 * 將 Blob 轉換為 Base64 字串
 */
const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = (reader.result as string).split(',')[1];
            resolve(base64String);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

/**
 * 使用後端代理 (Netlify/Vercel Functions) 進行語音轉文字
 */
export const transcribeAudioWithGemini = async (audioBlob: Blob, mimeType: string = "audio/wav"): Promise<string> => {
    const maxRetries = 3;
    let attempt = 0;

    const performRequest = async (): Promise<string> => {
        try {
            console.log(`[分析] 準備傳送音訊進行分析 (嘗試 ${attempt + 1})...`);

            // Detect environment and choose correct API path
            const isVercel = window.location.hostname.includes('vercel.app');
            const apiPath = isVercel ? "/api/transcribe" : "/.netlify/functions/transcribe";

            const base64Audio = await blobToBase64(audioBlob);

            const response = await fetch(apiPath, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ audioData: base64Audio, mimeType: mimeType }),
            });

            if (!response.ok) {
                let errorMsg = `Server responded with ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.error || errorMsg;
                } catch (e) { }

                if (response.status === 429 || response.status >= 500) {
                    throw new Error(errorMsg);
                }
                throw new Error(errorMsg);
            }

            const data = await response.json();
            if (data.text) {
                console.log("[分析] 分析成功，取得逐字稿。");
                return data.text;
            } else {
                throw new Error("No text returned from backend");
            }
        } catch (e: any) {
            console.error(`[分析] 嘗試 ${attempt + 1} 失敗:`, e);
            if (attempt < maxRetries) {
                attempt++;
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                console.log(`[分析] API 繁忙或受限，${(delay / 1000).toFixed(1)} 秒後進行重試...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return performRequest();
            }
            throw e;
        }
    };

    try {
        return await performRequest();
    } catch (e: any) {
        throw new Error(`分析服務忙碌中 (流量限制)，請稍後手動重試: ${e.message}`);
    }
};
