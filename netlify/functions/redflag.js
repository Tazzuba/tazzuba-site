// netlify/functions/redflag.js
//
// Powers the standalone "red flag?" tool at /red-flag.html. Takes a
// described behaviour and returns a Stoic-framework verdict. Uses the
// same GEMINI_API_KEY as chat.js and classify.js.

const SYSTEM_PROMPT = `You are the verdict engine behind TAZZUBA's "Is It a Red Flag?" tool.

Someone will describe a behaviour from a partner or person they're dating.
Give a grounded, Stoic-framework read on it — not a diagnosis of the other
person's character or mental state, just a clear-eyed take on the behaviour
itself and what it suggests about how to respond.

Respond with ONLY a valid JSON object, no markdown fences, no extra text:
{
  "isRedFlag": true or false,
  "verdict": "2-3 sentences, direct and warm, in second person (\\"you\\"). Name what the behaviour is and isn't evidence of, and what a grounded response looks like. Avoid diagnosing the other person (no 'they are a narcissist' style claims) — focus on the behaviour and the reader's response to it.",
  "quote": "a short (under 15 words) real or closely paraphrased quote from Marcus Aurelius, Epictetus, or Seneca relevant to this situation"
}

Judge fairly — not everything described is a red flag. A one-off miscommunication
is different from a pattern of dishonesty or disrespect. If the behaviour
described is ambiguous or minor, say so honestly rather than manufacturing
drama.`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server is missing GEMINI_API_KEY." }) };
  }

  let behaviour;
  try {
    const body = JSON.parse(event.body || "{}");
    behaviour = (body.behaviour || "").toString().slice(0, 500);
    if (!behaviour.trim()) throw new Error("empty");
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  const model = "gemini-3.5-flash";

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: behaviour }] }],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: { maxOutputTokens: 300, responseMimeType: "application/json" },
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error("Gemini redflag error:", res.status, JSON.stringify(data));
      return { statusCode: res.status, body: JSON.stringify({ error: "Upstream error" }) };
    }

    const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("Could not parse model JSON:", raw);
      return { statusCode: 502, body: JSON.stringify({ error: "Could not parse verdict" }) };
    }

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        isRedFlag: !!parsed.isRedFlag,
        verdict: parsed.verdict || "",
        quote: parsed.quote || "",
      }),
    };
  } catch (err) {
    console.error("Function error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Verdict engine temporarily unavailable." }) };
  }
};
