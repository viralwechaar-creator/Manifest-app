// Paraphrased from *The Secret* by Rhonda Byrne — not verbatim text.
export interface BookChapter {
  chapter: string;
  pages: string;
  topics: string[];
  content: string;
}

export const CORE_CHAPTERS: BookChapter[] = [
  {
    chapter: "The Secret Revealed",
    pages: "1-26",
    topics: ["law of attraction", "thoughts", "focus", "attention"],
    content:
      "The book's central claim: like attracts like. Dominant thoughts act like a signal, and life tends to bring back matching circumstances. It says attention on a problem strengthens it, and that the mind doesn't process negatives well — so state wants in positive form ('a calm morning', not 'not being late'). Your present reflects past thinking, but you can choose again right now; results come with a delay, which is exactly the room you have to choose differently."
  },
  {
    chapter: "The Secret Made Simple",
    pages: "27-45",
    topics: ["ask", "believe", "receive", "feelings"],
    content:
      "You can't monitor every thought, so watch how you feel instead — feeling bad signals focus on the unwanted; feeling good signals you're on track. The method in three steps: Ask (get specific about what you want — clarity is the asking), Believe (act, speak and think as if it's already yours, and drop doubt as it comes up), Receive (feel now the way you'd feel once you have it)."
  },
  {
    chapter: "How to Use The Secret",
    pages: "46-83",
    topics: ["ask", "believe", "receive", "visualization", "gratitude"],
    content:
      "Practical exercises for the Ask/Believe/Receive method: visualize the outcome from inside your own eyes, with the feeling attached (the feeling matters more than the picture); use gratitude, including gratitude in advance for what you asked for; the book separates 'inspired action' — action taken from pull and flow — from action taken from struggle and force, and says to act on the pull once you've asked and believed."
  },
  {
    chapter: "Powerful Processes",
    pages: "84-104",
    topics: ["feeling check", "gratitude", "visualization", "appreciation"],
    content:
      "A working toolkit: ask 'how am I feeling?' a few times a day and shift on purpose if it's low; keep a gratitude practice; visualize daily; make one small real change that matches the wish ('act as if'); replay a moment that went badly the way you wished it had gone before sleep ('evening revision'); think through the day each morning; quiet the mind for a few minutes."
  }
];

export const LIFE_AREA_CHAPTERS: Record<string, BookChapter> = {
  money: {
    chapter: "The Secret and Money",
    pages: "105-124",
    topics: ["money", "abundance", "earning", "budgeting"],
    content:
      "Focus on wealth, not lack. Play a make-believe game of already having the money; say 'I can afford that' when you see things you like, to shift your feeling about money rather than your feeling of scarcity; give generously while feeling you have plenty. The book's summary: feeling good about money now is the fastest route it describes."
  },
  relationships: {
    chapter: "The Secret and Relationships",
    pages: "125-140",
    topics: ["relationships", "appreciation", "self-respect", "connection"],
    content:
      "Make sure your thoughts, words, actions and surroundings don't contradict what you want. The book's core relationship instruction is inward first: fill yourself up, treat yourself with respect, focus on what you like about yourself. In existing relationships, focus on appreciation over complaint."
  },
  health: {
    chapter: "The Secret and Health",
    pages: "141-154",
    topics: ["health", "wellbeing", "gratitude", "medicine"],
    content:
      "Focus on the healthy state you want, not the illness — for weight, picture the ideal body and how it feels rather than 'losing weight'. The book links stress to negative thinking and highlights laughter, joy and gratitude. It also states mind-based approaches can run alongside medicine, and should never replace it in serious situations."
  },
  world: {
    chapter: "The Secret and the World",
    pages: "155-168",
    topics: ["world", "news", "peace", "attention"],
    content:
      "Attention repeatedly given to bad news adds to a person's own negativity, in the book's account. It recommends giving deliberate attention to peace, love and the outcomes you want to see instead."
  },
  you: {
    chapter: "The Secret and You",
    pages: "169-184",
    topics: ["beliefs", "past limits", "awareness", "identity"],
    content:
      "Let go of limits inherited from the past. Treat what you want as already fact rather than arguing for the current limitation. 'Remember to remember' — keep returning awareness to your own thinking throughout the day, since that's the whole practice."
  },
  life: {
    chapter: "The Secret and Life",
    pages: "185-190",
    topics: ["joy", "love", "feeling good", "purpose"],
    content:
      "Feel good now, as the throughline of the whole method. Do what you love; if it's unclear what that is, the book suggests asking 'what is my joy?' as the compass question."
  }
};

export const COACH_LAYER = `Coach layer (added by this app, not the book):
For each mindset practice, pair a concrete real-world action with a time, a size, and a way to check it's done. A step only counts as real if it names what, when, how long, and how you'll know it's done.
Money/business: clarity + visualization -> write the exact target number and date, track income/spending for 7 days, one income action this week (a call, an offer, an invoice, a pitch).
Career: ask + visualize the role -> name one skill gap, apply/ask/practice for 20 minutes today.
Relationships: appreciation + self-respect -> one honest conversation, one boundary, one act of connection.
Health/body: focus on the wanted state + gratitude for the body -> one measurable habit (walk, sleep, water, a meal), book a checkup if it's been a while.
Confidence/social: feeling check + revision -> one small exposure step per day.
Stuck/overwhelmed: feeling check + quiet mind -> break the goal into the smallest next step (under 10 minutes) and do it now.`;

export const GUARDRAILS = `Guardrails (always follow):
1. Call this "the book's method" or "the book teaches" — never present the law of attraction as proven fact, never promise outcomes.
2. Never suggest someone attracted abuse, harassment, an accident, illness, or a loss through their thoughts. Say instead: some things are outside your control, here's what you can control.
3. Health: never advise stopping treatment or medicine. Encourage professional care alongside mindset practices.
4. Money: no investment or financial-product advice. Budgeting and earning steps only. For serious debt, suggest a qualified advisor.
5. Never shame negative feelings — treat them as information, not failure.
6. If the person mentions self-harm, hopelessness, abuse, or crisis, drop the coaching format entirely and respond with care, encouraging a professional or crisis line.
7. Never quote long passages from the book — paraphrase, and name the chapter.`;

export function renderBookContext(lifeAreaKey: string): string {
  const areaChapter = LIFE_AREA_CHAPTERS[lifeAreaKey] || LIFE_AREA_CHAPTERS.life;
  const chapters = [...CORE_CHAPTERS, areaChapter];
  const chaptersText = chapters
    .map((c) => `### ${c.chapter} (pp. ${c.pages})\n${c.content}`)
    .join("\n\n");
  return `${chaptersText}\n\n${COACH_LAYER}\n\n${GUARDRAILS}`;
}
