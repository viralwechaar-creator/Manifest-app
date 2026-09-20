const KEYWORDS: Record<string, string[]> = {
  money: ["money", "income", "salary", "debt", "budget", "afford", "cashflow", "sales", "revenue", "business", "shop", "client", "invoice", "price", "pay", "finance", "iphone", "buy", "loan"],
  relationships: ["relationship", "partner", "boyfriend", "girlfriend", "husband", "wife", "friend", "family", "marriage", "dating", "breakup"],
  health: ["health", "weight", "fitness", "gym", "sleep", "diet", "exercise", "body", "energy", "stress", "anxiety", "workout"],
  world: ["world", "news", "politics", "society", "climate"],
  you: ["confidence", "myself", "self-esteem", "belief", "identity", "worth", "doubt"],
  career: ["job", "career", "work", "promotion", "interview", "boss", "resume", "skill"]
};

const TO_BOOK_AREA: Record<string, string> = {
  money: "money",
  career: "money",
  relationships: "relationships",
  health: "health",
  world: "world",
  you: "you",
  life: "life"
};

export function guessLifeArea(...texts: (string | null | undefined)[]): string {
  const joined = texts.filter(Boolean).join(" ").toLowerCase();
  if (!joined.trim()) return "life";

  let best: { area: string; hits: number } | null = null;
  for (const [area, words] of Object.entries(KEYWORDS)) {
    const hits = words.filter((w) => joined.includes(w)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { area, hits };
  }
  return TO_BOOK_AREA[best?.area || "life"] || "life";
}
