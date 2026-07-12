// netlify/functions/chat.js
//
// Backend for the TAZZUBA site assistant. Runs as a Netlify Function so the
// Gemini API key never touches the browser. The widget in index.html calls
// this at /api/chat (redirected to this function via netlify.toml).
//
// Uses Google AI Studio's Gemini API (generativelanguage.googleapis.com),
// billed to your existing Gemini account — same key you used to set up
// Hermes Agent.

const SYSTEM_PROMPT = `You are the TAZZUBA site assistant, embedded on tazzuba.com.

TAZZUBA is a Human Operations Engineering institute founded by Derrick Sekiziyivu,
registered as a trade name of Therrid Consultancy Inc. (BC, Canada). It applies
Stoic philosophy (the dichotomy of control, the four virtues) as explicit logic
for leadership, paired with practical AI-agent automation for the workflows
around a leader.

What you can help visitors with:
1. Answer questions about TAZZUBA, Algorithmic Stoicism, and Human Operations
   Engineering (HOE) in plain language — no jargon dumps.
2. Recommend the right product for what someone describes needing:
   - The HOS™ book series (Algorithmic Stoicism, The Focus Code, Human
     Algorithms, The Systems Leader) — for leaders/managers wanting the core
     framework. Point them to books.tazzuba.com.
   - The Stoic Relationships Mastery workbook — a 90-day guided program for
     people working on relationships specifically. Also on books.tazzuba.com.
   - The TAZZUBA store (store.tazzuba.com) for the wider product line.
3. If a visitor seems interested in ongoing updates, naturally offer to note
   their email — but only ask once, don't push, and never invent a discount
   or offer that wasn't given to you.
4. TAZZUBA also offers two direct services, described on the "Work With Us"
   section of this page:
   - Premium Ghostwriting — books, LinkedIn content, and executive
     thought-leadership writing in the client's own voice.
   - AI Consulting — hands-on implementation of the HOE framework inside a
     business, including deploying AI agents to automate workflows.
   If a visitor describes wanting either of these (not a book purchase, but
   hiring TAZZUBA directly), point them to the inquiry form in the "Work
   With Us" section.

Ground rules:
- Be direct and warm, not salesy. Short paragraphs, no more than ~120 words
  per reply unless the visitor is asking for something detailed.
- Never state or imply a price for anything — books, workbook, ghostwriting,
  or consulting. If asked about cost, say pricing is handled directly
  (books/store checkout, or the inquiry form for services) and you don't
  have current rates to quote.
- If you don't know something specific (release dates, Institute launch
  date, capacity for new consulting clients), say so plainly rather than
  guessing.
- Never claim to be human. If asked, you're TAZZUBA's site assistant.
- The Institute, Journal, and Studio wings are not live yet — say "coming
  soon" if asked, don't imply they can be accessed now.`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Server is missing GEMINI_API_KEY. Set it in Netlify Site settings → Environment variables.",
      }),
    };
  }

  let messages;
  try {
    const body = JSON.parse(event.body || "{}");
    messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("messages must be a non-empty array");
    }
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  // Trim to the last 20 turns so a long conversation can't run up cost unbounded.
  const trimmed = messages.slice(-20);

  // Gemini uses "model" instead of "assistant" for the AI's turns, and wraps
  // text in a "parts" array rather than a flat string.
  const contents = trimmed.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const model = "gemini-2.5-flash"; // matches your existing paid Gemini tier

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: { maxOutputTokens: 500 },
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error("Gemini API error:", res.status, JSON.stringify(data));
      return { statusCode: res.status, body: JSON.stringify({ error: data?.error?.message || "Upstream error" }) };
    }

    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reply: text }),
    };
  } catch (err) {
    console.error("Function error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Assistant is temporarily unavailable." }) };
  }
};
