import { query } from "@tencent-ai/agent-sdk";
import type { ChatTurn, Criterion, DecisionResponse, RankedOption, Recommendation } from "../shared/types.js";
import { buildDecisionPrompt } from "./prompt.js";

function collectText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }

  const content = (message as { message?: { content?: Array<{ type?: string; text?: string }> } }).message?.content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

function clampScore(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeCriteria(input: unknown): Criterion[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [
      { name: "长期收益", weight: 35, reason: "决策不能只看眼前舒适度。" },
      { name: "执行成本", weight: 30, reason: "再好的方案，做不动也没意义。" },
      { name: "后悔风险", weight: 35, reason: "真正让人卡住的，通常是对未来后悔的恐惧。" }
    ];
  }

  return input.slice(0, 5).map((item, index) => {
    const current = item as Partial<Criterion>;
    return {
      name: current.name?.trim() || `评估维度 ${index + 1}`,
      weight: typeof current.weight === "number" ? Math.max(0, Math.min(100, Math.round(current.weight))) : 20,
      reason: current.reason?.trim() || "这是当前判断中的一个关键维度。"
    };
  });
}

function normalizeOptions(input: unknown): RankedOption[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [
      {
        id: "A",
        label: "原方案 A",
        origin: "user",
        score: 70,
        summary: "当前信息不足，只能给出保守判断。",
        bestWhen: "你更重视稳定与可执行性时。",
        tradeoffs: ["信息不完整", "结论仍需下一轮澄清"]
      },
      {
        id: "B",
        label: "原方案 B",
        origin: "user",
        score: 65,
        summary: "有潜力，但风险轮廓还不够清楚。",
        bestWhen: "你愿意承担更多波动换取更高上限时。",
        tradeoffs: ["短期波动更大", "需要更强执行力"]
      }
    ];
  }

  return input.slice(0, 4).map((item, index) => {
    const current = item as Partial<RankedOption>;
    return {
      id: current.id?.trim() || String.fromCharCode(65 + index),
      label: current.label?.trim() || `方案 ${index + 1}`,
      origin: (current.origin === "expanded" ? "expanded" : "user") as "expanded" | "user",
      score: clampScore(current.score, 60 - index * 3),
      summary: current.summary?.trim() || "这是一个可以认真考虑的备选方案。",
      bestWhen: current.bestWhen?.trim() || "当你的资源、目标和承受力与它匹配时。",
      tradeoffs: Array.isArray(current.tradeoffs)
        ? current.tradeoffs.slice(0, 3).map((tradeoff) => String(tradeoff))
        : ["需要额外承担一些取舍"]
    };
  }).sort((a, b) => b.score - a.score);
}

function normalizeRecommendation(input: unknown, options: RankedOption[]): Recommendation {
  const current = (input ?? {}) as Partial<Recommendation>;
  const fallbackWinner = options[0]?.id ?? "A";
  const fallbackRunnerUp = options[1]?.id;

  return {
    winnerId: current.winnerId?.trim() || fallbackWinner,
    confidence: clampScore(current.confidence, options[0]?.score ?? 72),
    rationale: current.rationale?.trim() || "在当前信息下，这个方案兼顾了收益、可执行性和后悔风险。",
    runnerUpId: current.runnerUpId?.trim() || fallbackRunnerUp,
    actionPlan: Array.isArray(current.actionPlan) && current.actionPlan.length > 0
      ? current.actionPlan.slice(0, 4).map((step) => String(step))
      : ["先确认你最在意的评估标准", "把推荐方案做成 7 天内可执行的最小动作"],
    watchouts: Array.isArray(current.watchouts) && current.watchouts.length > 0
      ? current.watchouts.slice(0, 4).map((item) => String(item))
      : ["不要一边想要上限，一边只按稳定性打分"] ,
    assumptions: Array.isArray(current.assumptions) && current.assumptions.length > 0
      ? current.assumptions.slice(0, 4).map((item) => String(item))
      : ["用户当前提供的信息基本真实", "短期约束条件不会立即发生剧烈变化"]
  };
}

function extractJsonBlock(rawText: string): string {
  const fenced = rawText.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const first = rawText.indexOf("{");
  const last = rawText.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return rawText.slice(first, last + 1);
  }

  return rawText.trim();
}

function parseDecisionResponse(rawText: string): DecisionResponse {
  const jsonBlock = extractJsonBlock(rawText);

  try {
    const parsed = JSON.parse(jsonBlock) as Partial<DecisionResponse>;
    const options = normalizeOptions(parsed.options);

    return {
      coachReply: parsed.coachReply?.trim() || "我先给你一个当前判断：别继续空转，先用统一标准看方案。",
      stage: parsed.stage === "recommendation_ready" ? "recommendation_ready" : "need_more_context",
      keyTension: parsed.keyTension?.trim() || "你卡住的不是选项本身，而是标准没有排出先后。",
      nextQuestion: parsed.nextQuestion?.trim() || "如果 3 个月后必须承担结果，你更怕错过上限，还是更怕失去稳定？",
      criteria: normalizeCriteria(parsed.criteria),
      options,
      recommendation: normalizeRecommendation(parsed.recommendation, options)
    };
  } catch {
    const options = normalizeOptions(undefined);
    return {
      coachReply: "我已经先做了保守判断，但这轮模型输出没有完全结构化，所以我给你一个兜底版本。",
      stage: "need_more_context",
      keyTension: "你的目标、约束和后悔点还没有完全对齐。",
      nextQuestion: "在这次选择里，你最不能接受的代价到底是什么？",
      criteria: normalizeCriteria(undefined),
      options,
      recommendation: normalizeRecommendation(undefined, options)
    };
  }
}

export async function runDecisionAgent(history: ChatTurn[]): Promise<DecisionResponse> {
  const prompt = buildDecisionPrompt(history);
  const response = query({
    prompt,
    options: {
      maxTurns: 1,
      canUseTool: async () => ({
        behavior: "deny",
        message: "这个 Web 应用只允许进行决策分析，不开放额外工具。",
        interrupt: true
      })
    }
  });

  let rawText = "";

  for await (const message of response) {
    if ((message as { type?: string }).type === "assistant") {
      rawText += collectText(message);
    }
  }

  return parseDecisionResponse(rawText);
}
