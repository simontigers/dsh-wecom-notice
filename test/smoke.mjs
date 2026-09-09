// dsh-wecom-notice 冒烟测试：假 cordis ctx + 拦截 fetch，验证全链路
process.env.DSH_HOME = "/tmp/dsh-wecom-notice-test-home";

import { mkdir, writeFile } from "node:fs/promises";
await mkdir(process.env.DSH_HOME + "/profiles/web", { recursive: true });
await writeFile(
  process.env.DSH_HOME + "/profiles/web/package.json",
  JSON.stringify({ dependencies: { "dsh-wecom-notice": "github:simontigers/dsh-wecom-notice#v0.4.1" } }),
);

const captured = [];
let githubTags = [];
let githubFail = false;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("api.github.com")) {
    if (githubFail) throw new Error("network down");
    return new Response(JSON.stringify(githubTags), { status: 200 });
  }
  captured.push({ url, body: JSON.parse(init.body) });
  return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 });
};

const { apply } = await import("../lib/index.js");

const routes = [];
const listeners = {};
const logs = [];
const effects = [];
const ctx = {
  root: null,
  logger: { info: (m) => logs.push("info: " + m), warn: (m) => logs.push("warn: " + m) },
  webServer: { register: (def) => (routes.push(def), () => {}) },
  webRuntime: { trustedHosts: [] },
  effect: (fn, label) => (effects.push({ fn, label }), fn),
  provide: (n, s) => (ctx[n] = s),
  on: (event, handler) => ((listeners[event] ??= []).push(handler), () => {}),
};

apply(ctx);

// 触发全部 effect（store 生命周期 / API 路由 / 事件监听清理）
for (const e of effects) e.fn();
await new Promise((r) => setTimeout(r, 50));

const assert = (cond, label) => {
  if (!cond) { console.error("FAIL:", label); process.exitCode = 1; }
  else console.log("ok:", label);
};

// ---- 工具：调用 HTTP 路由
import { EventEmitter } from "node:events";
function callApi(method, payload) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = "POST";
    req.url = "/wecom-notice/api/" + method;
    req.headers = { host: "127.0.0.1:3080", origin: "http://127.0.0.1:3080" };
    const res = { code: 0, body: "", writeHead(c) { res.code = c; }, end(b) { res.body = String(b ?? ""); resolve(JSON.parse(res.body)); } };
    const route = routes[0];
    if (!route) { resolve({ ok: false, error: "no route" }); return; }
    void route.handler(req, res);
    if (payload !== undefined) req.emit("data", Buffer.from(JSON.stringify(payload)));
    req.emit("end");
  });
}

// ---- 1. get 返回默认配置
const g = (await callApi("get", {})).value;
assert(g.config && g.config.events.turnEndFail === true && g.config.templates.turnEndBody.includes("{workspace}"), "get 返回默认配置");

// ---- 2. save 草稿（webhook 指向会被拦截的地址，防抖 200ms）
const draft = { enabled: true, webhook: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=TEST", msgtype: "text", debounceMs: 200, summaryMaxChars: 500, events: { turnEnd: true, turnEndFail: true, approval: true, agentError: true }, templates: {} };
const s = (await callApi("save", { config: draft })).value;
assert(s.config && s.config.webhook.includes("key=TEST"), "save 保存成功");

// ---- 3. 会话事件：turn/end completed → 防抖后推送，模板渲染
const session = { id: "session-abcdef12-3456", header: { cwd: "/home/hu.sima/tmp/test_dsh" }, events: [{ type: "assistant/message", data: { message: { content: [{ type: "text", text: "这是最后的助手输出摘要" }] } } }] };
const ev = { type: "turn/end", seq: 42, data: { reason: { kind: "completed" } } };
for (const h of listeners["session/event"]) h(session, ev);
await new Promise((r) => setTimeout(r, 400));
assert(captured.length === 1, "turn/end 推送 1 次（防抖窗口后）");
const body1 = captured[0]?.body?.text?.content ?? "";
assert(body1.includes("✅ 任务完成通知") && body1.includes("🌍 工作区   ·  test_dsh") && body1.includes("🧵 任务ID   ·  abcdef12"), "标题渲染 workspace+session: " + JSON.stringify(body1.split("\n")[0]));
assert(body1.includes("这是最后的助手输出摘要"), "正文渲染 summary");

// ---- 4. 去重：同 seq 重放不再推送
for (const h of listeners["session/event"]) h(session, ev);
await new Promise((r) => setTimeout(r, 400));
assert(captured.length === 1, "同 seq 去重，无第二次推送");

// ---- 5. 异常回合 → 走失败模板 + {kind}
const evFail = { type: "turn/end", seq: 43, data: { reason: { kind: "interrupted" } } };
for (const h of listeners["session/event"]) h(session, evFail);
await new Promise((r) => setTimeout(r, 400));
assert(captured.length === 2 && (captured[1].body.text.content).includes("⚠️ 任务异常通知") && (captured[1].body.text.content).includes("📌 状态     ·  ⚠️ interrupted"), "异常回合模板渲染");

// ---- 6. 审批事件
const evAppr = { type: "approval/asked", seq: 44, data: { toolName: "bash", reason: "运行测试命令" } };
for (const h of listeners["session/event"]) h(session, evAppr);
await new Promise((r) => setTimeout(r, 50));
assert(captured.length === 3 && (captured[2].body.text.content).includes("🔐 审批请求通知") && (captured[2].body.text.content).includes("🛠 工具     ·  bash") && (captured[2].body.text.content).includes("运行测试命令"), "审批模板渲染");

// ---- 7. agent/error
for (const h of listeners["agent/error"]) h({ agent: { id: "agent-1", session }, error: new Error("boom-测试") });
await new Promise((r) => setTimeout(r, 50));
assert(captured.length === 4 && (captured[3].body.text.content).includes("boom-测试"), "agent/error 模板渲染");

// ---- 8. envelope 信封签名兼容
for (const h of listeners["session/event"]) h({ session, event: { type: "turn/end", seq: 99, data: { reason: { kind: "completed" } } } });
await new Promise((r) => setTimeout(r, 400));
assert(captured.length === 5, "envelope 信封签名兼容");

// ---- 9. 服务接口
assert(typeof ctx.wecomNotice?.send === "function", "wecomNotice 服务已提供");
await ctx.wecomNotice.send({ title: "T", content: "C" });
assert(captured.length === 6 && captured[5].body.text.content === "T\nC", "服务 send 直推");

// ---- 10. test API（用草稿测试）
const t1 = (await callApi("test", { config: { ...draft, msgtype: "markdown" } })).value;
assert(t1.detail && t1.detail.includes("markdown"), "test API 用草稿发送");
assert(captured[captured.length - 1].body.msgtype === "markdown", "test API msgtype=markdown");

// ---- 11. webhook 校验拒绝 http://
const bad = await callApi("save", { config: { ...draft, webhook: "http://evil" } });
assert(bad.ok === false, "save 拒绝非 https webhook");

// ---- 12. 持久化文件
const { readFile } = await import("node:fs/promises");
const persisted = JSON.parse(await readFile(process.env.DSH_HOME + "/wecom-notice/config.json", "utf8"));
assert(persisted.webhook.includes("key=TEST") && persisted.debounceMs === 200, "配置已持久化到 DSH_HOME");

// ---- 13. 检查更新：github 安装 → 识别 currentTag 并发现新版本
githubTags = [{ name: "v0.5.0" }, { name: "v0.4.1" }, { name: "v0.4.2" }];
const cu1 = (await callApi("checkUpdate", {})).value;
assert(cu1.mode === "github" && cu1.currentTag === "v0.4.1" && cu1.latest === "v0.5.0" && cu1.upToDate === false && cu1.diskVersion === cu1.version && cu1.pendingRestart === false,
  "checkUpdate 识别 github 安装、取最高 semver tag 并发现新版本");

// ---- 14. 检查更新：已是最新
githubTags = [{ name: "v0.4.1" }, { name: "v0.3.0" }];
const cu2 = (await callApi("checkUpdate", {})).value;
assert(cu2.upToDate === true && cu2.latest === "v0.4.1", "checkUpdate 已是最新");

// ---- 15. 检查更新：主机侧网络失败 → latest=null 交浏览器兜底
githubFail = true;
const cu3 = (await callApi("checkUpdate", {})).value;
assert(cu3.mode === "github" && cu3.latest === null && cu3.repoSlug === "simontigers/dsh-wecom-notice" && cu3.currentTag === "v0.4.1",
  "checkUpdate 网络失败返回兜底信息");
githubFail = false;

// ---- 16. 检查更新：stop 后 store 生命周期不冲突（幂等再查一次）
const cu4 = (await callApi("checkUpdate", {})).value;
assert(cu4.upToDate === true, "checkUpdate 可重复调用");

console.log(process.exitCode ? "\n=== 有失败项 ===" : "\n=== 全部通过 ===");
console.log("captured:", captured.length, "| logs:", logs.length);
