# 决策黑带 Agent

一个基于 CodeBuddy Agent SDK 的 Web 应用 MVP。

它的定位不是“陪你纠结”，而是通过聊天式追问 + 结构化排序，帮助用户处理二选一决策，并在必要时补充第三种可执行走法。

## 功能特点

- 聊天式输入，降低表达门槛
- 黑带教练风格输出：直接、冷静、有结论
- 自动补充扩展选项（如延迟决策、小范围试错、阶段性方案）
- 按多维标准加权分析并排序
- 输出推荐方案、风险提醒、关键假设和下一步行动

## 技术栈

- 前端：React + Vite + TypeScript
- 后端：Express + WebSocket + TypeScript
- Agent：CodeBuddy Agent SDK (`@tencent-ai/agent-sdk`)

## 本地启动

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制一份环境变量文件：

```bash
cp .env.example .env
```

至少补充以下变量之一：

- `CODEBUDDY_API_KEY=你的_key`
- 或者在本机已有可复用的 CodeBuddy 登录态

默认开发配置：

```env
PORT=3001
VITE_WS_URL=ws://localhost:3001/ws
```

### 3. 启动开发环境

```bash
npm run dev
```

- 前端默认地址：`http://localhost:5173`
- WebSocket 服务：`ws://localhost:3001/ws`
- 健康检查：`http://localhost:3001/health`

## 使用建议

给 Agent 的输入越具体，结果越有判断力。推荐一次说清：

1. 你的两个候选项是什么
2. 你真正想要的目标是什么
3. 时间尺度有多长（比如 3 个月、1 年、3 年）
4. 你最不能接受的代价是什么

示例：

> 我在纠结继续留在大厂做运营，还是去一家 AI 创业公司做产品。现在 29 岁，有房贷，更看重未来 3 年成长，但也不能接受收入骤降太多。

## 当前实现说明

这个版本是一个可运行的 MVP，重点验证三件事：

- CodeBuddy SDK 是否能作为服务端决策引擎稳定工作
- 聊天式输入 + 结构化结果面板是否成立
- “黑带教练”这一产品气质是否足够清晰

后续可以继续扩展：

- 保存历史决策记录
- 多轮对比卡片视图
- 自定义维度权重
- 决策结果分享链接
- 更细粒度的流式输出体验
