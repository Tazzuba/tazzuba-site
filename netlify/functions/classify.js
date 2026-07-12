// netlify/functions/classify.js
//
// Powers the "Run the Algorithm" demo in the hero — takes a free-text
// challenge from a visitor and classifies it as within/outside their
// control, Stoic-style. Uses the same Gemini key as chat.js.

const SYSTEM_PROMPT = `You are the HOE Engine — the algorithmic core of TAZZUBA's Human Operating System.

Given a challenge someone is facing, classify it using the Stoic Dichotomy
of Control: is it within the person's direct control, or not?

Respond with ONLY a valid JSON object, no markdown fences, no extra text:
{
  "classification": "TRUE" or "FALSE",
  "action": "one precise action statement, under 16 words, imperative voice",
  "quote": "a real, short (under 15 words) quote from Marcus Aurelius, Epictetus, or Seneca relevant to this — paraphrase closely rather than guessing at an exact quote if unsure of the precise wording"
}

TRUE means it's within their control (their own choices, effort, response).
FALSE means it's outside their control (others' actions, external events,
outcomes, the past).`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server is missing GEMINI_API_KEY." }) };
  }

  let challenge;
  try {
    const body = JSON.parse(event.body || "{}");
    challenge = (body.challenge || "").toString().slice(0, 300);
    if (!challenge.trim()) throw new Error("empty");
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  const model = "gemini-2.5-flash";

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: challenge }] }],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: { maxOutputTokens: 200, responseMimeType: "application/json" },
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error("Gemini classify error:", res.status, JSON.stringify(data));
      return { statusCode: res.status, body: JSON.stringify({ error: "Upstream error" }) };
    }

    const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("Could not parse model JSON:", raw);
      return { statusCode: 502, body: JSON.stringify({ error: "Could not parse classification" }) };
    }

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        classification: parsed.classification === "TRUE" ? "TRUE" : "FALSE",
        action: parsed.action || "",
        quote: parsed.quote || "",
      }),
    };
  } catch (err) {
    console.error("Function error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Classifier temporarily unavailable." }) };
  }
};
