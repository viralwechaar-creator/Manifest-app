import { CoachReply } from "./types";

const CRISIS_PATTERNS = [
  /\bsuicid/i,
  /\bkill myself\b/i,
  /\bend my life\b/i,
  /\bself[\s-]?harm/i,
  /\bhurt myself\b/i,
  /\bwant to die\b/i,
  /\bno reason to live\b/i
];

export function detectCrisisLanguage(text: string): boolean {
  return CRISIS_PATTERNS.some((re) => re.test(text));
}

export const CRISIS_REPLY: CoachReply = {
  reply:
    "I want to pause the coaching for a moment. What you're describing matters more than any plan or step right now. If you're in immediate danger, please contact your local emergency number. In the US you can call or text 988 (the Suicide & Crisis Lifeline) any time. If you're outside the US, the International Association for Suicide Prevention keeps a list of crisis centers at https://www.iasp.info/resources/Crisis_Centres/. Please consider reaching out to a mental health professional or someone you trust today. I'm still here whenever you want to keep talking or come back to your plan.",
  situation_summary: "The person shared something that may involve crisis, self-harm, or hopelessness.",
  book_principles: [],
  mind_practice: { practice: "Other", instructions: "Not applicable right now.", minutes: 0 },
  milestones: [],
  actions: [],
  beliefs_detected: [],
  follow_up_question: "Would it help to talk about what's going on, or would you rather I just share some resources?",
  safety_flag: true
};

export function busyReply(): CoachReply {
  return {
    reply:
      "The coach is a little overloaded right now and couldn't get back to you. Nothing was lost — please try again in a minute or two.",
    situation_summary: "",
    book_principles: [],
    mind_practice: { practice: "Other", instructions: "", minutes: 0 },
    milestones: [],
    actions: [],
    beliefs_detected: [],
    follow_up_question: "",
    safety_flag: false
  };
}
