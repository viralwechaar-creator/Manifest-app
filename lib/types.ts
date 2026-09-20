export type GoalStatus = "active" | "paused" | "completed" | "archived";
export type MilestoneStatus = "pending" | "active" | "completed" | "skipped";
export type StepStatus = "pending" | "done" | "skipped" | "replaced";
export type BeliefStatus = "active" | "retired";
export type ChatRole = "user" | "assistant" | "system";

export interface Profile {
  id: string;
  display_name: string | null;
  timezone: string | null;
}

export interface Goal {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  target_date: string | null;
  created_at: string;
}

export interface Milestone {
  id: string;
  goal_id: string;
  user_id: string;
  title: string;
  description: string | null;
  target_date: string | null;
  sort_order: number;
  status: MilestoneStatus;
}

export interface Step {
  id: string;
  user_id: string;
  goal_id: string | null;
  milestone_id: string | null;
  title: string;
  description: string | null;
  scheduled_for: string | null;
  scheduled_time: string | null;
  minutes: number | null;
  done_when: string | null;
  status: StepStatus;
  source: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Checkin {
  id: string;
  user_id: string;
  goal_id: string | null;
  checkin_date: string;
  done_text: string | null;
  blocked_text: string | null;
  feeling: string | null;
  coach_reply: CoachReply | null;
  created_at: string;
}

export interface Belief {
  id: string;
  user_id: string;
  goal_id: string | null;
  original_text: string;
  replacement_text: string | null;
  action_text: string | null;
  status: BeliefStatus;
  created_at: string;
}

export interface GratitudeEntry {
  id: string;
  user_id: string;
  text: string;
  created_at: string;
}

export interface Affirmation {
  id: string;
  user_id: string;
  goal_id: string | null;
  text: string;
  active: boolean;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  goal_id: string | null;
  role: ChatRole;
  content: string;
  metadata: any;
  created_at: string;
}

export type CoachMode = "intake" | "checkin" | "mindscan";

export interface CoachReply {
  reply: string;
  situation_summary: string;
  book_principles: { name: string; chapter: string; why_it_applies: string }[];
  mind_practice: { practice: string; instructions: string; minutes: number };
  milestones: string[];
  actions: {
    title: string;
    why: string;
    when: string;
    minutes: number;
    done_when: string;
  }[];
  beliefs_detected: { belief: string; evidence: string; replacement: string; action: string }[];
  follow_up_question: string;
  safety_flag: boolean;
  debug_error?: string;
}
