import { CoachReply } from "./types";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const COACH_REPLY_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    situation_summary: { type: "STRING" },
    book_principles: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          chapter: { type: "STRING" },
          why_it_applies: { type: "STRING" }
        },
        required: ["name", "chapter", "why_it_applies"]
      }
    },
    mind_practice: {
      type: "OBJECT",
      properties: {
        practice: { type: "STRING" },
        instructions: { type: "STRING" },
        minutes: { type: "NUMBER" }
      },
      required: ["practice", "instructions", "minutes"]
    },
    milestones: { type: "ARRAY", items: { type: "STRING" } },
    actions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          why: { type: "STRING" },
          when: { type: "STRING" },
          minutes: { type: "NUMBER" },
          done_when: { type: "STRING" }
        },
        required: ["title", "why", "when", "minutes", "done_when"]
      }
    },
    beliefs_detected: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          belief: { type: "STRING" },
          evidence: { type: "STRING" },
          replacement: { type: "STRING" },
          action: { type: "STRING" }
        },
        required: ["belief", "evidence", "replacement", "action"]
      }
    },
    follow_up_question: { type: "STRING" },
    safety_flag: { type: "BOOLEAN" }
  },
  required: [
    "reply",
    "situation_summary",
    "book_principles",
    "mind_practice",
    "milestones",
    "actions",
    "beliefs_detected",
    "follow_up_question",
    "safety_flag"
  ]
};

export class GeminiUnavailableError extends Error {}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function callCoach(systemPrompt: string, userMessage: string): Promise<CoachReply> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set on the server.");

  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const url = `${GEMINI_URL}/${model}:generateContent?key=${apiKey}`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: COACH_REPLY_SCHEMA,
      temperature: 0.7,
      maxOutputTokens: 2048
    }
  };

  const MAX_ATTEMPTS = 3;
  let lastError: any = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (networkErr: any) {
      lastError = networkErr;
      await sleep(500 * attempt * attempt);
      continue;
    }

    if (res.status === 429) {
      const text = await res.text();
      throw new GeminiUnavailableError(`Gemini quota exceeded (429) — this is a free-tier daily/per-minute cap, not a transient error, so retrying won't help right now: ${text}`);
    }

    if (res.status === 503) {
      lastError = new Error(`Gemini ${res.status}: ${await res.text()}`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(500 * attempt * attempt);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const text = candidate?.content?.parts?.map((p: any) => p.text || "").join("") || "";

    if (!text) {
      lastError = new Error(`Gemini returned no text (finishReason: ${finishReason}).`);
      if (finishReason === "MAX_TOKENS") {
        throw lastError;
      }
      await sleep(500 * attempt * attempt);
      continue;
    }

    try {
      return JSON.parse(text) as CoachReply;
    } catch (parseErr) {
      lastError = new Error(`Gemini returned malformed JSON: ${text.slice(0, 300)}`);
      await sleep(500 * attempt * attempt);
      continue;
    }
  }

  console.error("Gemini call failed after retries:", lastError);
  throw new GeminiUnavailableError(lastError?.message || "Gemini is temporarily unavailable.");
}
