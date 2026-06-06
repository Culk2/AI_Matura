// Vercel serverless funkcija – semantično ocenjevanje odgovorov z Google Gemini.
// Postavi to datoteko v mapo /api v korenu projekta:  /api/oceni.js
//
// Nastavi okoljsko spremenljivko v Vercelu:  GEMINI_API_KEY = <tvoj ključ>
// (Vercel → Project → Settings → Environment Variables)
//
// API ključ dobiš brezplačno na: https://aistudio.google.com  (Get API key)

// Model: gemini-2.5-flash-lite ima najvišjo brezplačno kvoto (1000 zahtev/dan).
// Za malenkost boljšo kakovost lahko zamenjaš v "gemini-2.5-flash" (250/dan).
const MODEL = 'gemini-2.5-flash-lite';

const SYSTEM_PROMPT = `Si izkušen ocenjevalec slovenske poklicne mature iz računalništva.
Tvoja naloga je oceniti, ali dijak RAZUME snov – ne ali je uporabil enake besede kot referenčni odgovor.

PRI VSAKEM VPRAŠANJU PREJMEŠ: vprašanje, referenčni odgovor in odgovor dijaka.

POSTOPEK:
1. Najprej iz referenčnega odgovora ugotovi, katere informacije so BISTVENE, kateri koncepti so najpomembnejši in kaj mora dijak pokazati, da razume snov.
2. Nato presodi, koliko teh bistvenih konceptov je dijak dejansko zajel po POMENU.

PRAVILA OCENJEVANJA (zelo pomembno):
- Ocenjuj POMEN in RAZUMEVANJE, NIKOLI ujemanja besed ali odstotka enakega besedila.
- Če dijak pove isto stvar z drugimi besedami, je to PRAVILNO.
- Sopomenke, krajša razlaga, drugačen vrstni red informacij ali angleški/slovenski izrazi NE smejo znižati ocene.
- Če dijak doda dodatne PRAVILNE informacije, ga to NE sme kaznovati.
- Slovnične napake, tipkarske napake in manjše jezikovne napake imajo ZANEMARLJIV vpliv.
- Upoštevaj, da je odgovor pogosto GOVORJEN (prepis govora), zato so možne manjše napake pri prepoznavi besed – bodi razumevajoč.
- Če bi človeški ocenjevalec presodil, da dijak očitno razume snov, naj bo tudi tvoja ocena visoka.
- Daj prednost semantični podobnosti pred dobesednim ujemanjem.

OCENJEVALNA LESTVICA (0–100):
- 90–100: Odgovor izraža skoraj enak pomen kot referenčni odgovor. Manjkajo le manjše podrobnosti.
- 75–89: Večina bistvenih konceptov je pravilno zajetih. Prisotne so manjše pomanjkljivosti.
- 50–74: Prikazano je delno razumevanje. Nekateri pomembni koncepti manjkajo ali so nepopolni.
- 25–49: Odgovor vsebuje malo pravilnih informacij ali več pomembnih napak.
- 0–24: Odgovor je večinoma napačen ali ne kaže razumevanja teme.

VRNI izključno JSON s polji:
- "score": celo število 0–100
- "verdict": "ok" če score >= 75, "partial" če 50–74, sicer "bad"
- "title": kratka ocena v slovenščini (največ 8 besed)
- "feedback": konstruktiven feedback v slovenščini – najprej kaj je dijak pokazal dobro, nato kaj manjka ali bi izboljšal (največ 120 besed). Nagovori dijaka z "ti".
- "missing": seznam (array) kratkih nizov – ključni koncepti/informacije, ki jih je dijak izpustil (0–6 elementov; prazen array če ni nič pomembnega manjkalo)
- "speak": zelo kratko besedilo za glasno branje, naravno slovensko (največ 35 besed)`;

export default async function handler(req, res) {
  // Dovoli klice z iste in drugih strani (varno – ključ ostane na strežniku)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Uporabi POST.' }); return; }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Manjka GEMINI_API_KEY. Nastavi ga v Vercel → Settings → Environment Variables.' });
    return;
  }

  // Razčleni telo (Vercel ga običajno že parsira, a za vsak primer)
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { question, reference, answer } = body || {};

  if (!question || !reference || !answer) {
    res.status(400).json({ error: 'Manjkajo polja: question, reference, answer.' });
    return;
  }

  const userPrompt =
    'VPRAŠANJE:\n' + question + '\n\n' +
    'REFERENČNI ODGOVOR:\n' + reference + '\n\n' +
    'ODGOVOR DIJAKA (lahko prepis govora):\n' + answer + '\n\n' +
    'Oceni odgovor dijaka po navodilih in vrni JSON.';

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + apiKey;

  try {
    const gres = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              score:   { type: 'INTEGER' },
              verdict: { type: 'STRING', enum: ['ok', 'partial', 'bad'] },
              title:   { type: 'STRING' },
              feedback:{ type: 'STRING' },
              missing: { type: 'ARRAY', items: { type: 'STRING' } },
              speak:   { type: 'STRING' }
            },
            required: ['score', 'verdict', 'title', 'feedback', 'speak']
          }
        }
      })
    });

    if (!gres.ok) {
      const errText = await gres.text();
      // 429 = presežena brezplačna kvota
      if (gres.status === 429) {
        res.status(429).json({ error: 'Dosežena dnevna brezplačna meja Gemini. Poskusi kasneje.' });
        return;
      }
      res.status(502).json({ error: 'Gemini napaka (' + gres.status + '): ' + errText.slice(0, 300) });
      return;
    }

    const data = await gres.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { res.status(502).json({ error: 'Neveljaven odgovor modela.' }); return; }

    // Varnostne meje
    let score = parseInt(parsed.score, 10);
    if (isNaN(score)) score = 0;
    score = Math.max(0, Math.min(100, score));
    let verdict = parsed.verdict;
    if (!['ok','partial','bad'].includes(verdict)) {
      verdict = score >= 75 ? 'ok' : score >= 50 ? 'partial' : 'bad';
    }

    res.status(200).json({
      score,
      verdict,
      title: parsed.title || '',
      feedback: parsed.feedback || '',
      missing: Array.isArray(parsed.missing) ? parsed.missing.slice(0, 6) : [],
      speak: parsed.speak || parsed.title || ''
    });
  } catch (e) {
    res.status(500).json({ error: 'Napaka strežnika: ' + (e && e.message ? e.message : String(e)) });
  }
}
