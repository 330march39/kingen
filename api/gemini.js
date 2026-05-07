export default async function handler(req, res) {
  // POSTリクエスト以外は弾く
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { prompt, schema } = req.body;
  
  // ここでVercelの環境変数を読み込みます（ブラウザからは見えません）
  const apiKey = process.env.API_KEY; 

  if (!apiKey) {
    return res.status(500).json({ error: 'API key is not configured on Vercel' });
  }

  try {
    // GoogleのGemini APIへリクエスト
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: { type: "OBJECT", properties: schema }
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Gemini API Error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    // JSONに変換してフロントエンドへ返す
    res.status(200).json(JSON.parse(text));
    
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Failed to fetch AI response' });
  }
}
