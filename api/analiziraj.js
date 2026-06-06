// ===== /api/analiziraj.js =====
// Vercel serverless funkcija.
// Vhod:  { text: "<celotno besedilo dokumenta>" }
// Izhod: { topics: [string], pairs: [{ topic, question, reference }] }
//
// Namen: iz naloženega dokumenta (PDF/Word/besedilo) prepozna obstoječe
// pare vprašanje->odgovor ALI, če jih ni, sam ustvari kakovostna vprašanja
// in referenčne odgovore iz učne snovi.
//
// Potrebuje okoljsko spremenljivko GEMINI_API_KEY (Vercel -> Settings -> Environment Variables).

// Model: flash je dovolj kakovosten za eno analizo na dokument.
const MODEL = "gemini-2.5-flash";

// Varnostna omejitev velikosti vhoda (znakov). Daljše besedilo se odreže.
const MAX_CHARS = 120000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Manjka GEMINI_API_KEY na strežniku." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  let text = (body && body.text) ? String(body.text) : "";
  text = text.trim();

  if (text.length < 50) {
    return res.status(400).json({ error: "Premalo besedila za analizo (vsaj 50 znakov)." });
  }

  let truncated = false;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    truncated = true;
  }

  const system = [
    "Si izkušen maturitetni profesor. Iz danega dokumenta pripraviš gradivo za ustno izpraševanje.",
    "Postopek:",
    "1. Preberi celotno besedilo in ga razdeli na teme/podteme.",
    "2. Če dokument ŽE vsebuje vprašanja in odgovore, jih prepoznaj in shrani kot pare.",
    "3. Če vsebuje samo učno snov, sam ustvari kakovostna izpitna vprašanja in temeljite referenčne odgovore.",
    "Pravila za vprašanja:",
    "- Vprašanja naj pokrivajo VSE pomembne teme dokumenta, enakomerno razporejena.",
    "- Referenčni odgovor mora biti popoln in samostojen (vse bistvene informacije), v 2-6 stavkih.",
    "- Vprašanja naj bodo odprtega tipa (ne 'da/ne'), primerna za ustni izpit.",
    "- Število parov prilagodi obsegu snovi: kratko besedilo ~8-12, daljše do ~40.",
    "- Vse v slovenščini.",
    "Odgovoriš IZKLJUČNO z JSON objektom po podani shemi, brez dodatnega besedila."
  ].join("\n");

  const userPrompt = `DOKUMENT:\n"""\n${text}\n"""\n\nUstvari teme in pare vprašanje->odgovor.`;

  const payload = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          topics: { type: "ARRAY", items: { type: "STRING" } },
          pairs: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                topic: { type: "STRING" },
                question: { type: "STRING" },
                reference: { type: "STRING" }
              },
              required: ["question", "reference"]
            }
          }
        },
        required: ["topics", "pairs"]
      }
    }
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(502).json({ error: "Napaka Gemini API.", detail: errText.slice(0, 500) });
    }

    const data = await r.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // zasilno: poskusi izvleci JSON iz besedila
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    }

    if (!parsed || !Array.isArray(parsed.pairs) || parsed.pairs.length === 0) {
      return res.status(502).json({ error: "AI ni vrnil uporabnih vprašanj. Poskusi znova." });
    }

    // Počisti in normaliziraj
    const pairs = parsed.pairs
      .filter(p => p && p.question && p.reference)
      .map(p => ({
        topic: (p.topic || "Splošno").toString().trim(),
        question: p.question.toString().trim(),
        reference: p.reference.toString().trim()
      }));

    const topics = Array.isArray(parsed.topics)
      ? parsed.topics.map(t => String(t).trim()).filter(Boolean)
      : [];

    return res.status(200).json({ topics, pairs, truncated });
  } catch (e) {
    return res.status(500).json({ error: "Strežniška napaka.", detail: String(e).slice(0, 300) });
  }
}
