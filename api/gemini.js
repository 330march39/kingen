export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POSTメソッドのみ許可されています' });
  }

  try {
    const { prompt, schema } = req.body;

    // Vercelの環境変数からAPIキーを取得
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'APIキーが設定されていません' });
    }

    // スキーマをGemini用の形式に変換
    const properties = {};
    for (const [key, value] of Object.entries(schema)) {
      if (value.type === 'ARRAY') {
        properties[key] = { type: 'ARRAY', items: { type: 'STRING' } };
      } else {
        properties[key] = { type: value.type };
      }
    }

    // Gemini APIへリクエスト
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: properties,
              required: Object.keys(schema)
            }
          }
        })
      }
    );

    if (!geminiRes.ok) {
      const errData = await geminiRes.json();
      console.error('Gemini APIエラー:', errData);
      return res.status(500).json({ error: errData.error?.message || 'Gemini APIエラー' });
    }

    const geminiData = await geminiRes.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(500).json({ error: 'Geminiからの応答が空でした' });
    }

    const result = JSON.parse(text);
    return res.status(200).json(result);

  } catch (error) {
    console.error('サーバーエラー:', error);
    return res.status(500).json({ error: error.message || 'サーバー内部エラーが発生しました' });
  }
}
