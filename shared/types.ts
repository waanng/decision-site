export type DecisionStage = "need_more_context" | "recommendation_ready";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface Criterion {
  name: string;
  weight: number;
  reason: string;
}

export interface RankedOption {
  id: string;
  label: string;
  origin: "user" | "expanded";
  score: number;
  summary: string;
  bestWhen: string;
  tradeoffs: string[];
}

export interface Recommendation {
  winnerId: string;
  confidence: number;
  rationale: string;
  runnerUpId?: string;
  actionPlan: string[];
  watchouts: string[];
  assumptions: string[];
}

export interface DecisionResponse {
  coachReply: string;
  stage: DecisionStage;
  keyTension: string;
  nextQuestion: string;
  criteria: Criterion[];
  options: RankedOption[];
  recommendation: Recommendation;
}

export interface ClientMessage {
  type: "user_message";
  text: string;
}

export interface AuthGuide {
  title: string;
  message: string;
  steps: string[];
  envSnippet: string;
  docsUrl: string;
  detected: {
    hasApiKey: boolean;
    internetEnvironment?: string;
  };
}

export type ServerMessage =
  | { type: "ready"; greeting: string }
  | { type: "status"; phase: string }
  | { type: "analysis"; payload: DecisionResponse }
  | { type: "auth_required"; guide: AuthGuide }
  | { type: "error"; message: string };
