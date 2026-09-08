/**
 * dsh-wecom-notice — host half
 *
 * 企业微信群机器人通知插件：
 *   - 监听会话事件（回合结束 / 审批请求）与 agent/error 总线事件
 *   - 按用户自定义模板（占位符渲染）组装 title + content，POST 到企业微信群
 *     机器人 webhook（msgtype: text | markdown）
 *   - 配置持久化在 $DSH_HOME/wecom-notice/config.json，由客户端设置页通过
 *     /wecom-notice/api/* 读写
 *   - 对外提供 `wecomNotice` cordis 服务：ctx.get('wecomNotice').send({title, content})
 *
 * 无第三方运行时依赖：HTTP 使用内置 fetch。
 * 设置页 UI 参考了 chicheng-push（MIT）与官方 dsh-cost-meter 的客户端挂载方式。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// ---------------------------------------------------------------- identity

const name = "dsh-wecom-notice";
const NS = "dsh-wecom-notice";
const inject = ["webServer", "webRuntime"];

// ---------------------------------------------------------------- paths

const DATA_ROOT = process.env.DSH_HOME
  ? join(process.env.DSH_HOME, "wecom-notice")
  : join(homedir(), ".dsh", "wecom-notice");
const STORE_PATH = join(DATA_ROOT, "config.json");

// ---------------------------------------------------------------- config

const DEFAULT_TEMPLATES = {
  turnEndTitle: "╔══════════════════════╗\n║  ✅ 任务完成通知       ║\n╚══════════════════════╝",
  turnEndBody: "🌍 工作区   ·  {workspace}\n🧵 任务ID   ·  {session}\n⏰ 完成时间 ·  {time}\n📌 状态     ·  ✅ 成功\n\n┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n\n💬 执行摘要\n{summary}\n\n┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n\n🤖 来源     ·  DeepSeek Harness",
  turnEndFailTitle: "╔══════════════════════╗\n║  ⚠️ 任务异常通知       ║\n╚══════════════════════╝",
  turnEndFailBody: "🌍 工作区   ·  {workspace}\n🧵 任务ID   ·  {session}\n⏰ 完成时间 ·  {time}\n📌 状态     ·  ⚠️ {kind}\n\n┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n\n💬 执行摘要\n{summary}\n\n┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n\n🤖 来源     ·  DeepSeek Harness",
  approvalTitle: "╔══════════════════════╗\n║  🔐 审批请求通知       ║\n╚══════════════════════╝",
  approvalBody: "🌍 工作区   ·  {workspace}\n🧵 任务ID   ·  {session}\n⏰ 请求时间 ·  {time}\n🛠 工具     ·  {tool}\n📝 原因     ·  {reason}\n\n┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n\n💬 当前回复\n{summary}\n\n┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n\n🤖 来源     ·  DeepSeek Harness",
  errorTitle: "╔══════════════════════╗\n║  ❌ Agent 出错通知     ║\n╚══════════════════════╝",
  errorBody: "🌍 工作区   ·  {workspace}\n🧵 任务ID   ·  {session}\n⏰ 时间     ·  {time}\n📌 状态     ·  ❌ 出错\n\n┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n\n💥 错误信息\n{error}\n\n┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n\n🤖 来源     ·  DeepSeek Harness",
};

const TEMPLATE_KEYS = Object.keys(DEFAULT_TEMPLATES);

const DEFAULT_CONFIG = {
  version: 1,
  enabled: true,
  webhook: "",
  msgtype: "text",
  debounceMs: 10000,
  summaryMaxChars: 500,
  events: { turnEnd: true, turnEndFail: true, approval: true, agentError: true },
  templates: { ...DEFAULT_TEMPLATES },
};

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/** 把任意输入规整成完整、合法的配置对象（深拷贝默认值再覆盖）。 */
function normalizeConfig(input) {
  const src = input !== null && typeof input === "object" ? input : {};
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.enabled = src.enabled !== false;
  cfg.webhook = typeof src.webhook === "string" ? src.webhook.trim() : "";
  cfg.msgtype = src.msgtype === "markdown" ? "markdown" : "text";
  cfg.debounceMs = clampInt(src.debounceMs, 0, 300000, DEFAULT_CONFIG.debounceMs);
  cfg.summaryMaxChars = clampInt(src.summaryMaxChars, 20, 1800, DEFAULT_CONFIG.summaryMaxChars);
  const ev = src.events !== null && typeof src.events === "object" ? src.events : {};
  cfg.events.turnEnd = ev.turnEnd !== false;
  cfg.events.turnEndFail = ev.turnEndFail !== false;
  cfg.events.approval = ev.approval !== false;
  cfg.events.agentError = ev.agentError !== false;
  const tpl = src.templates !== null && typeof src.templates === "object" ? src.templates : {};
  for (const key of TEMPLATE_KEYS) {
    if (typeof tpl[key] === "string" && tpl[key].length > 0) cfg.templates[key] = tpl[key];
  }
  return cfg;
}

// ---------------------------------------------------------------- store

let store = normalizeConfig(null);
let storeLoaded = false;
let storeDirtyTimer = null;

async function loadStore() {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    store = normalizeConfig(JSON.parse(raw));
  } catch {
    store = normalizeConfig(null);
  }
  storeLoaded = true;
}

function scheduleSave() {
  if (storeDirtyTimer !== null) return;
  storeDirtyTimer = setTimeout(() => {
    storeDirtyTimer = null;
    void flushStore();
  }, 150);
}

async function flushStore() {
  try {
    await mkdir(DATA_ROOT, { recursive: true });
    const tmp = `${STORE_PATH}.tmp`;
    await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
    await rename(tmp, STORE_PATH);
  } catch (error) {
    console.error(`[${NS}] store flush failed:`, error);
  }
}

// ---------------------------------------------------------------- util

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function errorText(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function clampChars(text, max) {
  const s = String(text ?? "").trim();
  if (!Number.isFinite(max) || s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function shortId(session) {
  const id = String(session?.id ?? "");
  if (id === "") return "-";
  return id.replace(/^session-/, "").slice(0, 8) || "-";
}

function workspaceName(session) {
  const cwd = session?.header?.cwd;
  if (typeof cwd !== "string" || cwd === "") return "未知工作区";
  return basename(cwd) || cwd;
}

function lastAssistantText(session) {
  const events = session?.events;
  if (!Array.isArray(events)) return "";
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "assistant/message") continue;
    const blocks = event.data?.message?.content;
    if (!Array.isArray(blocks)) continue;
    const text = blocks
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (text.length > 0) return text;
  }
  return "";
}

function nowTime() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function nowDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 已知占位符替换；未知 token 原样保留，方便用户发现拼写错误。 */
function renderTemplate(template, vars) {
  return String(template ?? "").replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match);
}

// ---------------------------------------------------------------- dedup

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEDUP_MAX = 3000;
const seen = new Map();

function seenOnce(key) {
  const now = Date.now();
  for (const [k, ts] of seen) {
    if (now - ts > DEDUP_WINDOW_MS) seen.delete(k);
  }
  if (seen.has(key)) return true;
  seen.set(key, now);
  if (seen.size > DEDUP_MAX) {
    const first = seen.keys().next().value;
    seen.delete(first);
  }
  return false;
}

function hashOf(text) {
  return createHash("sha1").update(String(text)).digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------- wecom send

const WECOM_TIMEOUT_MS = 12000;

/**
 * POST 到群机器人 webhook。文本消息 content 上限 2048 字节；长文本
 * （摘要/错误）已由 renderWithLongText 按字节预算截断，这里只兜底校验。
 */
async function sendWecom(cfg, title, content) {
  if (typeof cfg.webhook !== "string" || !/^https:\/\//.test(cfg.webhook)) {
    throw new Error("Webhook 未配置或不是 https URL");
  }
  const full = `${title}\n${content}`;
  const body = cfg.msgtype === "markdown"
    ? { msgtype: "markdown", markdown: { content: full } }
    : { msgtype: "text", text: { content: full } };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WECOM_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(cfg.webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  let parsed = null;
  try {
    parsed = text === "" ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed.errcode === "number" && parsed.errcode !== 0) {
    throw new Error(`企业微信错误 errcode=${parsed.errcode}: ${parsed.errmsg ?? "unknown"}`);
  }
  return "已发送";
}

// ---------------------------------------------------------------- push intents

/**
 * 企业微信 text content 上限 2048 字节。卡片模板里的制表符（╔ ═ ┈）都是
 * 3 字节字符，先渲染一遍「长文本留空」的模板算出固定开销，再把长文本
 * （摘要/错误信息）按剩余字节预算截断，保证卡片尾部（来源行）不被挤掉。
 */
const WECOM_TEXT_BYTE_BUDGET = 1900;

function renderWithLongText(cfg, template, title, vars, longKey, longText) {
  const overheadTemplate = renderTemplate(template, { ...vars, [longKey]: "" });
  const overheadBytes = Buffer.byteLength(overheadTemplate) + Buffer.byteLength(String(title)) + 1;
  const roomChars = Math.floor((WECOM_TEXT_BYTE_BUDGET - overheadBytes) / 3);
  vars[longKey] = clampChars(longText, Math.max(50, Math.min(cfg.summaryMaxChars, roomChars)));
  return renderTemplate(template, vars);
}

function buildTurnEndVars(session, event, cfg) {
  const reason = isPlainObject(event?.data?.reason) ? event.data.reason : {};
  const kind = typeof reason.kind === "string" && reason.kind !== "" ? reason.kind : "unknown";
  return {
    workspace: workspaceName(session),
    session: shortId(session),
    sessionId: String(session?.id ?? "-"),
    kind,
    summary: "",
    error: typeof reason.error?.message === "string" ? reason.error.message : "",
    time: nowTime(),
    date: nowDate(),
  };
}

function pushTurnEnd(session, event, cfg, log) {
  const reason = isPlainObject(event?.data?.reason) ? event.data.reason : {};
  const kind = typeof reason.kind === "string" && reason.kind !== "" ? reason.kind : "unknown";
  const completed = kind === "completed";
  const vars = buildTurnEndVars(session, event, cfg);
  const title = renderTemplate(completed ? cfg.templates.turnEndTitle : cfg.templates.turnEndFailTitle, vars);
  const body = renderWithLongText(cfg, completed ? cfg.templates.turnEndBody : cfg.templates.turnEndFailBody, title, vars, "summary", lastAssistantText(session));
  return sendWecom(cfg, title, body)
    .catch((error) => log(`推送失败（turn/end）: ${errorText(error)}`));
}

function pushApproval(session, event, cfg, log) {
  const data = isPlainObject(event?.data) ? event.data : {};
  const reason = data.reason;
  const reasonText = typeof reason === "string"
    ? reason
    : (typeof reason?.message === "string" ? reason.message : (typeof reason?.kind === "string" ? reason.kind : ""));
  const vars = {
    workspace: workspaceName(session),
    session: shortId(session),
    sessionId: String(session?.id ?? "-"),
    tool: typeof data.toolName === "string" && data.toolName !== "" ? data.toolName : "tool",
    reason: reasonText,
    summary: "",
    time: nowTime(),
    date: nowDate(),
  };
  const title = renderTemplate(cfg.templates.approvalTitle, vars);
  const body = renderWithLongText(cfg, cfg.templates.approvalBody, title, vars, "summary", lastAssistantText(session));
  return sendWecom(cfg, title, body)
    .catch((error) => log(`推送失败（approval/asked）: ${errorText(error)}`));
}

function pushAgentError(payload, cfg, log) {
  const error = payload?.error;
  const detail = error instanceof Error
    ? error.message
    : (typeof error === "string" ? error : (error?.message ?? "agent 执行出错"));
  const agentSession = payload?.agent?.session;
  const vars = {
    workspace: workspaceName(agentSession),
    session: shortId(agentSession),
    sessionId: String(agentSession?.id ?? "-"),
    error: "",
    time: nowTime(),
    date: nowDate(),
  };
  const title = renderTemplate(cfg.templates.errorTitle, vars);
  const body = renderWithLongText(cfg, cfg.templates.errorBody, title, vars, "error", detail);
  return sendWecom(cfg, title, body)
    .catch((error2) => log(`推送失败（agent/error）: ${errorText(error2)}`));
}

// ---------------------------------------------------------------- event wiring

/** 兼容 (session, event) 元组与 {session, event} 信封两种宿主签名。 */
function normalizeSessionEventArgs(args) {
  if (!Array.isArray(args)) return undefined;
  const [first, second] = args;
  const isRecord = (v) => v !== null && typeof v === "object";
  if (args.length === 2 && isRecord(first) && isRecord(second) && typeof second.type === "string") {
    return { session: first, event: second };
  }
  if (args.length === 1 && isRecord(first) && isRecord(first.session) && isRecord(first.event) && typeof first.event.type === "string") {
    return { session: first.session, event: first.event };
  }
  return undefined;
}

/** 宿主事件按注册 context 过滤；必要时退到 Cordis 根 context 订阅。 */
function selectHostEventContext(ctx) {
  const root = ctx?.root;
  if (root !== null && typeof root === "object" && root !== ctx && root?.root === root && typeof root.on === "function") {
    return root;
  }
  return ctx;
}

function wireEvents(ctx, cfgRef, disposers) {
  const hostCtx = selectHostEventContext(ctx);
  const log = (message) => {
    try {
      ctx.logger?.warn?.(`[${NS}] ${message}`);
    } catch {
      console.warn(`[${NS}] ${message}`);
    }
  };

  const pendingTurnPush = new Map();

  const scheduleTurnPush = (session, event) => {
    const reason = isPlainObject(event?.data?.reason) ? event.data.reason : {};
    const kind = typeof reason.kind === "string" && reason.kind !== "" ? reason.kind : "unknown";
    const completed = kind === "completed";
    if (completed ? !cfgRef.config.events.turnEnd : !cfgRef.config.events.turnEndFail) return;
    const sid = String(session?.id ?? "anon");
    const prev = pendingTurnPush.get(sid);
    if (prev !== undefined) clearTimeout(prev);
    const delay = Math.max(0, cfgRef.config.debounceMs);
    const timer = setTimeout(() => {
      pendingTurnPush.delete(sid);
      void pushTurnEnd(session, event, cfgRef.config, log);
    }, delay);
    pendingTurnPush.set(sid, timer);
  };

  disposers.push(hostCtx.on("session/event", (...args) => {
    try {
      const parsed = normalizeSessionEventArgs(args);
      if (parsed === undefined) return;
      const { session, event } = parsed;
      if (event?.seq !== undefined && event?.seq !== null) {
        if (seenOnce(`${event.type}:${session?.id ?? "anon"}:${event.seq}`)) return;
      }
      if (event.type === "turn/end") {
        scheduleTurnPush(session, event);
      } else if (event.type === "approval/asked") {
        if (cfgRef.config.events.approval) void pushApproval(session, event, cfgRef.config, log);
      }
    } catch (error) {
      log(`处理 session/event 失败: ${errorText(error)}`);
    }
  }));

  disposers.push(hostCtx.on("agent/error", (payload = {}) => {
    try {
      if (!cfgRef.config.events.agentError) return;
      const agentSession = payload?.agent?.session;
      const agentId = String(payload?.agent?.id ?? agentSession?.id ?? "anon");
      const error = payload?.error;
      const detail = error instanceof Error ? error.message : (typeof error === "string" ? error : (error?.message ?? ""));
      if (seenOnce(`agent/error:${agentId}:${hashOf(detail)}`)) return;
      void pushAgentError(payload, cfgRef.config, log);
    } catch (error) {
      log(`处理 agent/error 失败: ${errorText(error)}`);
    }
  }));

  disposers.push(() => {
    for (const timer of pendingTurnPush.values()) clearTimeout(timer);
    pendingTurnPush.clear();
  });
}

// ---------------------------------------------------------------- HTTP fence

function headerOf(request, name2) {
  try {
    const value = request?.headers?.[name2];
    if (Array.isArray(value)) return value[0];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function parseAuthority(value) {
  try {
    const url = new URL(`http://${value}`);
    if (url.hostname === "") return undefined;
    return { hostname: url.hostname, port: url.port, host: url.host };
  } catch {
    return undefined;
  }
}

function isLoopbackHostname(hostname) {
  const parts = String(hostname).split(".");
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") return true;
  return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isTrustedApiRequest(request, trustedHosts) {
  const host = headerOf(request, "host");
  if (host === undefined) return false;
  const hostUrl = parseAuthority(host);
  if (hostUrl === undefined) return false;
  const hosts = Array.isArray(trustedHosts) ? trustedHosts : [];
  const trusted = hosts.some((entry) => {
    const entryUrl = parseAuthority(String(entry));
    if (entryUrl === undefined) return false;
    return entryUrl.hostname === hostUrl.hostname && (entryUrl.port === "" || entryUrl.port === hostUrl.port);
  });
  if (!isLoopbackHostname(hostUrl.hostname) && !trusted) return false;
  if (headerOf(request, "sec-fetch-site") === "cross-site") return false;
  const origin = headerOf(request, "origin");
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

function writeJson(res, status, value) {
  try {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(value));
  } catch {
    /* response already gone */
  }
}

function writeOk(res, value) {
  writeJson(res, 200, { ok: true, value });
}

function writeError(res, error) {
  const message = error instanceof Error ? error.message : String(error);
  writeJson(res, 200, { ok: false, error: { code: "wecom-notice", message } });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 512 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw === "") {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------- API

function buildApi(cfgRef, log) {
  const sampleVars = () => ({
    workspace: "示例工作区",
    session: "a1b2c3d4",
    sessionId: "session-a1b2c3d4-0000-0000",
    kind: "completed",
    summary: "这是一条测试摘要：任务已按预期完成，占位符渲染正常。",
    error: "示例错误：连接超时（测试占位符）",
    tool: "bash",
    reason: "示例原因：运行测试命令",
    time: nowTime(),
    date: nowDate(),
  });

  return {
    async get() {
      return { config: normalizeConfig(cfgRef.config) };
    },

    async save(payload) {
      const next = normalizeConfig(payload?.config);
      if (next.webhook !== "" && !/^https:\/\//.test(next.webhook)) {
        throw new Error("Webhook 必须是 https:// 开头的 URL");
      }
      cfgRef.config = next;
      store = next;
      scheduleSave();
      log(`配置已保存（enabled=${next.enabled}, msgtype=${next.msgtype}, webhook=${next.webhook === "" ? "未配置" : "已配置"}）`);
      return { config: normalizeConfig(cfgRef.config) };
    },

    /** 测试发送：优先用表单草稿（未保存也能测）。 */
    async test(payload) {
      const cfg = payload?.config !== undefined ? normalizeConfig(payload.config) : normalizeConfig(cfgRef.config);
      const vars = sampleVars();
      const title = renderTemplate(cfg.templates.turnEndTitle, vars);
      const body = renderTemplate(cfg.templates.turnEndBody, vars);
      const detail = await sendWecom(cfg, title, clampChars(body, cfg.summaryMaxChars));
      return { detail: `${detail}（msgtype=${cfg.msgtype}）` };
    },
  };
}

// ---------------------------------------------------------------- plugin

export const apply = (ctx) => {
  const cfgRef = { config: store };
  const disposers = [];
  const log = (message) => {
    try {
      ctx.logger?.info?.(`[${NS}] ${message}`);
    } catch {
      console.log(`[${NS}] ${message}`);
    }
  };

  ctx.effect(() => {
    void loadStore().then(() => {
      cfgRef.config = store;
    });
    return () => {
      void flushStore();
    };
  }, "dsh-wecom-notice: store lifecycle");

  const api = buildApi(cfgRef, log);

  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: "/wecom-notice/api",
    handler: async (req, res) => {
      if (!isTrustedApiRequest(req, ctx.webRuntime?.trustedHosts ?? [])) {
        writeJson(res, 403, { ok: false, error: { code: "forbidden", message: "forbidden" } });
        return;
      }
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: { code: "method-error", message: "method not allowed" } });
        return;
      }
      const pathname = new URL(req.url ?? "/", "http://wecom-notice.invalid").pathname;
      const tail = pathname.startsWith("/wecom-notice/api/") ? pathname.slice("/wecom-notice/api/".length) : undefined;
      if (tail === undefined || tail.includes("/") || tail === "") {
        writeError(res, new Error("unknown wecom-notice API method"));
        return;
      }
      try {
        const payload = await readJsonBody(req);
        const handler = api[tail];
        if (typeof handler !== "function") throw new Error(`unknown wecom-notice API method "${tail}"`);
        writeOk(res, await handler(payload));
      } catch (error) {
        writeError(res, error);
      }
    },
  }), "dsh-wecom-notice: /wecom-notice/api routes");

  wireEvents(ctx, cfgRef, disposers);
  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try {
        dispose?.();
      } catch {
        /* already gone */
      }
    }
    disposers.length = 0;
  }, "dsh-wecom-notice: event listeners");

  // 供其他插件调用：ctx.get('wecomNotice')?.send({ title, content })
  ctx.provide("wecomNotice", {
    async send({ title, content }) {
      return sendWecom(normalizeConfig(cfgRef.config), String(title ?? ""), String(content ?? ""));
    },
  });

  log("started");
};

export { inject, name };
