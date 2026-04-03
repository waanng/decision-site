import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AuthGuide, ClientMessage, DecisionResponse, ServerMessage } from "../shared/types";

type ChatItem = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

const EXAMPLES = [
  "该留在大厂继续升职，还是去创业团队赌更高上限？",
  "我是先考研再找工作，还是直接去做产品实习？",
  "现在要不要买车，还是继续打车 + 周末租车更划算？"
];

const fallbackAnalysis: DecisionResponse = {
  coachReply: "先把你的 A、B 两个选项和背景打给我，我会帮你拆标准、补第三种走法，再直接给出当前推荐。",
  stage: "need_more_context",
  keyTension: "你的选择还没开始被统一标准审视。",
  nextQuestion: "这两个选项里，你现在真正怕失去的是什么？",
  criteria: [
    { name: "长期收益", weight: 35, reason: "别只看眼前轻松，长期回报更决定这步值不值。" },
    { name: "执行成本", weight: 30, reason: "你做得动，方案才有资格赢。" },
    { name: "后悔风险", weight: 35, reason: "很多纠结，本质都是在躲未来的后悔。" }
  ],
  options: [
    {
      id: "A",
      label: "你的原始选项 A",
      origin: "user",
      score: 72,
      summary: "等待你给出真实上下文后再精算。",
      bestWhen: "你更看重稳定、可控和短期确定性时。",
      tradeoffs: ["上限可能不够高", "容易因为惯性而高估"]
    },
    {
      id: "B",
      label: "你的原始选项 B",
      origin: "user",
      score: 69,
      summary: "通常代表另一种收益结构或风险结构。",
      bestWhen: "你愿意承担更多波动，换取更大成长空间时。",
      tradeoffs: ["短期不确定性更大", "对执行力要求更高"]
    }
  ],
  recommendation: {
    winnerId: "A",
    confidence: 72,
    rationale: "先别急着要答案，把问题说具体，我才能把推荐从感觉升级成判断。",
    runnerUpId: "B",
    actionPlan: ["把 A 和 B 明确写出来", "补充你的目标、期限和约束", "告诉我你最怕哪种后悔"],
    watchouts: ["不要把不同标准混着比", "不要把情绪当成事实"],
    assumptions: ["用户还没有给出完整背景", "当前分数只是示意，不是最终结论"]
  }
};

function scoreTone(score: number) {
  if (score >= 80) return "is-strong";
  if (score >= 70) return "is-solid";
  return "is-watch";
}

function App() {
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [analysis, setAnalysis] = useState<DecisionResponse>(fallbackAnalysis);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState("正在待命");
  const [connected, setConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authGuide, setAuthGuide] = useState<AuthGuide | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const defaultWsUrl =
      typeof window !== "undefined"
        ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`
        : "ws://localhost:3001/ws";
    const wsUrl = import.meta.env.VITE_WS_URL || defaultWsUrl;
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => setConnected(true);
    socket.onclose = () => {
      setConnected(false);
      setPhase("连接已断开，请刷新页面重连");
    };

    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data) as ServerMessage;

      if (payload.type === "ready") {
        setAuthGuide(null);
        setMessages([
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: payload.greeting
          }
        ]);
        setPhase("随时可以开始");
        return;
      }

      if (payload.type === "status") {
        setIsLoading(true);
        setPhase(payload.phase);
        return;
      }

      if (payload.type === "analysis") {
        setIsLoading(false);
        setAuthGuide(null);
        setPhase(payload.payload.stage === "recommendation_ready" ? "结论已更新" : "还差一锤定音");
        setAnalysis(payload.payload);
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: payload.payload.coachReply
          }
        ]);
        return;
      }

      if (payload.type === "auth_required") {
        setIsLoading(false);
        setPhase("需要先完成认证");
        setAuthGuide(payload.guide);
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: `${payload.guide.title}\n${payload.guide.message}`
          }
        ]);
        return;
      }

      if (payload.type === "error") {
        setIsLoading(false);
        setAuthGuide(null);
        setPhase("分析失败");
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: payload.message
          }
        ]);
      }
    };

    return () => socket.close();
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const rankedWinner = useMemo(
    () => analysis.options.find((option) => option.id === analysis.recommendation.winnerId) ?? analysis.options[0],
    [analysis]
  );

  const submitMessage = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    const outgoing: ClientMessage = {
      type: "user_message",
      text: trimmed
    };

    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: trimmed
      }
    ]);
    setInput("");
    setIsLoading(true);
    setPhase("正在拆解你的决策逻辑");
    wsRef.current.send(JSON.stringify(outgoing));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitMessage(input);
  };

  return (
    <div className="app-shell">
      <div className="app-grid">
        <section className="panel hero-panel">
          <div className="hero-topline">
            <span className={`status-dot ${connected ? "online" : "offline"}`} />
            <span>{connected ? "教练在线" : "连接中断"}</span>
            <span className="phase-pill">{phase}</span>
          </div>

          <div className="hero-copy">
            <p className="eyebrow">DECISION BLACKBELT</p>
            <h1>别再原地纠结。把 A 和 B 扔过来，我帮你拆出结论。</h1>
            <p className="hero-description">
              聊天式追问，黑带教练式判断。它会补充隐藏选项、按关键维度排序，并直接告诉你现在更该选哪边。
            </p>
          </div>

          <div className="examples">
            {EXAMPLES.map((example) => (
              <button key={example} type="button" className="example-chip" onClick={() => submitMessage(example)}>
                {example}
              </button>
            ))}
          </div>
        </section>

        <section className="panel chat-panel">
          <div className="panel-header">
            <div>
              <p className="panel-eyebrow">对话区</p>
              <h2>像聊天一样说，把背景讲清楚就行</h2>
            </div>
          </div>

          <div className="chat-stream">
            {messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <span className="message-role">{message.role === "assistant" ? "黑带教练" : "你"}</span>
                <p>{message.text}</p>
              </article>
            ))}

            {isLoading ? (
              <article className="message assistant loading-card">
                <span className="message-role">黑带教练</span>
                <p>{phase}</p>
              </article>
            ) : null}
            <div ref={messageEndRef} />
          </div>

          {authGuide ? (
            <aside className="auth-guide-card">
              <p className="panel-eyebrow">认证引导</p>
              <h3>{authGuide.title}</h3>
              <p>{authGuide.message}</p>

              <div className="auth-meta">
                <span>服务端检测</span>
                <strong>{authGuide.detected.hasApiKey ? "已检测到 API Key" : "未检测到 API Key"}</strong>
                <small>
                  网络环境：
                  {authGuide.detected.internetEnvironment ? authGuide.detected.internetEnvironment : "未设置"}
                </small>
              </div>

              <ul className="plain-list auth-steps">
                {authGuide.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>

              <div className="auth-snippet">
                <span>.env 至少这样写</span>
                <pre>{authGuide.envSnippet}</pre>
              </div>

              <div className="auth-actions">
                <a className="auth-link" href={authGuide.docsUrl} target="_blank" rel="noreferrer">
                  查看 SDK 认证文档
                </a>
                <button type="button" className="ghost-button" onClick={() => window.location.reload()}>
                  我已改好配置，刷新页面
                </button>
              </div>
            </aside>
          ) : null}

          <form className="composer" onSubmit={handleSubmit}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="例如：我在纠结留在现在的工作，还是去一家更小但成长更快的公司。我 29 岁，手上有房贷，更看重未来 3 年发展。"
              rows={4}
            />
            <div className="composer-footer">
              <p>建议一次说清：两个选项、你的目标、时间尺度、不能接受的代价。</p>
              <button type="submit" disabled={!connected || isLoading || !input.trim()}>
                开始推演
              </button>
            </div>
          </form>
        </section>

        <section className="panel insight-panel">
          <div className="panel-header compact">
            <div>
              <p className="panel-eyebrow">当前判断</p>
              <h2>{analysis.keyTension}</h2>
            </div>
            <div className="confidence-card">
              <span>信心值</span>
              <strong>{analysis.recommendation.confidence}</strong>
            </div>
          </div>

          <div className="winner-card">
            <div>
              <p className="panel-eyebrow">当前推荐</p>
              <h3>{rankedWinner?.label ?? analysis.recommendation.winnerId}</h3>
            </div>
            <p>{analysis.recommendation.rationale}</p>
          </div>

          <div className="section-block">
            <div className="section-heading">
              <h3>方案排序</h3>
              <span>含扩展选项</span>
            </div>
            <div className="option-list">
              {analysis.options.map((option) => (
                <article key={option.id} className="option-card">
                  <div className="option-head">
                    <div>
                      <div className="option-label-row">
                        <strong>{option.label}</strong>
                        <span className={`score-tag ${scoreTone(option.score)}`}>{option.score}</span>
                      </div>
                      <p>{option.summary}</p>
                    </div>
                    <span className={`origin-tag ${option.origin}`}>{option.origin === "expanded" ? "扩展方案" : "原始方案"}</span>
                  </div>
                  <p className="best-when">最适合：{option.bestWhen}</p>
                  <ul>
                    {option.tradeoffs.map((tradeoff) => (
                      <li key={tradeoff}>{tradeoff}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>

          <div className="two-column-grid">
            <div className="section-block">
              <div className="section-heading">
                <h3>评估维度</h3>
                <span>权重越高，越不能装看不见</span>
              </div>
              <div className="criteria-list">
                {analysis.criteria.map((criterion) => (
                  <article key={criterion.name} className="criterion-card">
                    <div className="criterion-row">
                      <strong>{criterion.name}</strong>
                      <span>{criterion.weight}</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-bar" style={{ width: `${criterion.weight}%` }} />
                    </div>
                    <p>{criterion.reason}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="section-block">
              <div className="section-heading">
                <h3>下一步</h3>
                <span>{analysis.stage === "recommendation_ready" ? "可以执行" : "还差关键澄清"}</span>
              </div>
              <div className="next-step-card">
                <p className="next-question">{analysis.nextQuestion}</p>
                <ol>
                  {analysis.recommendation.actionPlan.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          </div>

          <div className="two-column-grid">
            <div className="section-block subtle">
              <div className="section-heading">
                <h3>风险提醒</h3>
                <span>别在这些地方翻车</span>
              </div>
              <ul className="plain-list">
                {analysis.recommendation.watchouts.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="section-block subtle">
              <div className="section-heading">
                <h3>判断前提</h3>
                <span>这些前提一变，结论就要重算</span>
              </div>
              <ul className="plain-list">
                {analysis.recommendation.assumptions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
