import "dotenv/config";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { AuthGuide, ClientMessage, ChatTurn, DecisionResponse, ServerMessage } from "../shared/types.js";
import { runDecisionAgent } from "./decisionAgent.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "decision-blackbelt-agent" });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const conversations = new WeakMap<WebSocket, ChatTurn[]>();

function send(socket: WebSocket, payload: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function hasValue(value: string | undefined) {
  return Boolean(value?.trim());
}

function isAuthenticationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /Authentication required|Please use \/login command|CODEBUDDY_API_KEY|auth/i.test(error.message);
}

function buildAuthGuide(): AuthGuide {
  const hasApiKey = hasValue(process.env.CODEBUDDY_API_KEY);
  const internetEnvironment = process.env.CODEBUDDY_INTERNET_ENVIRONMENT?.trim();

  let message = "当前服务端没有可用的 CodeBuddy 认证信息，所以 SDK 拒绝执行决策推演。";
  let steps: string[] = [
    "在项目根目录创建或补全 .env 文件。",
    "把国内版 key 放进 CODEBUDDY_API_KEY，并设置 CODEBUDDY_INTERNET_ENVIRONMENT=internal。",
    "停止当前 npm run dev，重新启动后再刷新页面。"
  ];

  if (hasApiKey && internetEnvironment !== "internal") {
    message = "服务端已经读到 API Key，但国内版环境变量还没对上。中国版 key 必须配 internal。";
    steps = [
      "保留你现在的 CODEBUDDY_API_KEY。",
      "补上 CODEBUDDY_INTERNET_ENVIRONMENT=internal。",
      "停止当前 npm run dev，重新启动后再刷新页面。"
    ];
  }

  if (hasApiKey && internetEnvironment === "internal") {
    message = "服务端已经读到 API Key 和 internal 环境。如果仍然报认证错，通常是 key 失效、复制带空格，或者服务还没用新环境重启。";
    steps = [
      "确认 .env 中的 key 没有多余空格、换行或旧值。",
      "彻底停止 npm run dev，再重新启动一次。",
      "如果还不通，就去控制台重新生成一枚新 key。"
    ];
  }

  return {
    title: "先把认证接通，这次推演不是逻辑坏了，是身份没过。",
    message,
    steps,
    envSnippet: [
      "CODEBUDDY_API_KEY=<你的国内版 key>",
      "CODEBUDDY_INTERNET_ENVIRONMENT=internal",
      "PORT=3001",
      "VITE_WS_URL=ws://localhost:3001/ws"
    ].join("\n"),
    docsUrl: "https://www.codebuddy.ai/docs/zh/cli/sdk",
    detected: {
      hasApiKey,
      internetEnvironment
    }
  };
}

function buildAssistantMemory(analysis: DecisionResponse): string {
  const winner = analysis.options.find((option) => option.id === analysis.recommendation.winnerId)?.label ?? analysis.recommendation.winnerId;
  return `${analysis.coachReply}\n当前推荐：${winner}。关键矛盾：${analysis.keyTension}`;
}

wss.on("connection", (socket, _request: IncomingMessage) => {
  conversations.set(socket, []);

  send(socket, {
    type: "ready",
    greeting: "把你的两个纠结选项和背景扔给我。我会像教练一样拆标准、补选项、排顺序，然后给你结论。"
  });

  socket.on("message", async (data) => {
    try {
      const incoming = JSON.parse(data.toString()) as ClientMessage;
      if (incoming.type !== "user_message" || !incoming.text?.trim()) {
        send(socket, { type: "error", message: "消息格式不正确，请重新输入。" });
        return;
      }

      const history = conversations.get(socket) ?? [];
      history.push({ role: "user", text: incoming.text.trim() });
      conversations.set(socket, history);

      send(socket, { type: "status", phase: "正在拆你的评价标准，而不是陪你空转。" });
      const analysis = await runDecisionAgent(history);

      history.push({ role: "assistant", text: buildAssistantMemory(analysis) });
      conversations.set(socket, history);

      send(socket, { type: "analysis", payload: analysis });
    } catch (error) {
      if (isAuthenticationError(error)) {
        send(socket, {
          type: "auth_required",
          guide: buildAuthGuide()
        });
        return;
      }

      const message = error instanceof Error ? error.message : "服务端发生未知错误。";
      send(socket, {
        type: "error",
        message: `这次决策推演没跑通：${message}`
      });
    }
  });
});

const port = Number(process.env.PORT || 3001);
server.listen(port, () => {
  console.log(`Decision Blackbelt server listening on http://localhost:${port}`);
});
