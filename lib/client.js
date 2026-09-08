/**
 * dsh-wecom-notice — client half (web settings page)
 *
 * 在 DSH 设置页注册「企业微信通知」区块：
 *   - 基础配置：启用开关 / Webhook / 消息类型 / 防抖 / 摘要长度
 *   - 事件开关：回合结束 / 审批请求 / Agent 出错
 *   - 模板编辑：每个事件的标题与正文模板（占位符渲染）
 *   - 操作：保存 / 测试发送（用当前表单值测试，无需先保存）
 *
 * 客户端通过同源 fetch 调用宿主 /wecom-notice/api/*。
 * 挂载方式与 chicheng-push（MIT）一致：slots.inject('settings.section', ...)。
 */
window.__ModuleLoader__.load({
  id: "dsh-wecom-notice",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    var createElement = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useCallback = React.useCallback;

    var Button = primitives.Button;

    var NS = "dsh-wecom-notice";

    // ---------------------------------------------------------------- locale

    var zh = {
      nav: "企业微信通知",
      intro: "通过企业微信群机器人推送通知：回合结束、需要审批、Agent 出错时按自定义模板发消息。支持 {workspace} / {session} / {summary} 等占位符，text/markdown 可选。",
      basic: "基础配置",
      enabled: "启用推送",
      enabledHint: "关闭后停止所有推送，配置保留",
      webhook: "群机器人 Webhook",
      webhookPh: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx",
      webhookHint: "企业微信群 → 群设置 → 群机器人 → 添加 → 复制 Webhook 地址",
      msgtype: "消息类型",
      msgtypeHint: "text：微信插件（个人微信）可显示；markdown：仅企业微信客户端渲染",
      debounce: "回合结束防抖（毫秒）",
      debounceHint: "同一会话短时间多次回合结束只推最后一条，0 为不防抖",
      summaryMax: "摘要最大长度（字符）",
      summaryMaxHint: "占位符 {summary} 与最终正文都会截断到该长度",
      events: "事件开关",
      evTurn: "回合结束（成功）",
      evTurnHint: "agent 正常完成一个回合时推送",
      evTurnFail: "回合异常结束",
      evTurnFailHint: "被打断 / 出错 / 达到上限 / 被阻止时推送",
      evApproval: "审批请求",
      evApprovalHint: "需要你批准某个工具调用时推送",
      evError: "Agent 出错",
      evErrorHint: "agent 执行链路报错时推送",
      templates: "消息模板",
      tplTurnTitle: "回合完成 · 标题",
      tplTurnBody: "回合完成 · 正文",
      tplTurnFailTitle: "回合异常 · 标题",
      tplTurnFailBody: "回合异常 · 正文",
      tplApprovalTitle: "审批请求 · 标题",
      tplApprovalBody: "审批请求 · 正文",
      tplErrorTitle: "Agent 出错 · 标题",
      tplErrorBody: "Agent 出错 · 正文",
      placeholders: "可用占位符",
      phHint: "{workspace} 工作区名 · {session} 会话短 ID · {summary} 最后助手输出摘要 · {tool} 工具名 · {reason} 审批原因 · {error} 错误信息 · {kind} 结束类型 · {time} 时间 · {date} 日期",
      save: "保存",
      saved: "已保存",
      saving: "保存中…",
      test: "测试发送",
      testing: "发送中…",
      testHint: "用当前表单值直接测试，不需要先保存",
      loadErr: "配置加载失败，请重试",
      retry: "重试",
      savedOk: "已保存 ✓",
      testOk: "测试消息已发送 ✓ ",
      needWebhook: "请先填写 Webhook 地址",
      dirty: "有未保存的修改",
    };

    var en = {
      nav: "WeCom Notice",
      intro: "Push notifications to a WeCom group robot: turn end, approval requests and agent errors, rendered from your own templates with placeholders like {workspace} / {session} / {summary}. text/markdown supported.",
      basic: "Basics",
      enabled: "Enable push",
      enabledHint: "Master switch; config is kept when disabled",
      webhook: "Group robot webhook",
      webhookPh: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx",
      webhookHint: "WeCom group → settings → group robot → add → copy webhook URL",
      msgtype: "Message type",
      msgtypeHint: "text: visible in WeChat plugin; markdown: WeCom client only",
      debounce: "Turn-end debounce (ms)",
      debounceHint: "Merge rapid turn-ends per session; 0 disables",
      summaryMax: "Summary max length (chars)",
      summaryMaxHint: "Clamps {summary} and the final body",
      events: "Events",
      evTurn: "Turn end (success)",
      evTurnHint: "Push when the agent completes a turn",
      evTurnFail: "Turn ended abnormally",
      evTurnFailHint: "Interrupted / errored / max tokens / blocked",
      evApproval: "Approval request",
      evApprovalHint: "Push when a tool call needs your approval",
      evError: "Agent error",
      evErrorHint: "Push when the agent pipeline errors",
      templates: "Templates",
      tplTurnTitle: "Turn end · title",
      tplTurnBody: "Turn end · body",
      tplTurnFailTitle: "Turn abnormal · title",
      tplTurnFailBody: "Turn abnormal · body",
      tplApprovalTitle: "Approval · title",
      tplApprovalBody: "Approval · body",
      tplErrorTitle: "Agent error · title",
      tplErrorBody: "Agent error · body",
      placeholders: "Placeholders",
      phHint: "{workspace} workspace · {session} short session id · {summary} last assistant excerpt · {tool} tool name · {reason} approval reason · {error} error message · {kind} end kind · {time} time · {date} date",
      save: "Save",
      saved: "Saved",
      saving: "Saving…",
      test: "Send test",
      testing: "Sending…",
      testHint: "Tests with current form values; no need to save first",
      loadErr: "Failed to load config, please retry",
      retry: "Retry",
      savedOk: "Saved ✓",
      testOk: "Test message sent ✓ ",
      needWebhook: "Please fill the webhook URL first",
      dirty: "Unsaved changes",
    };

    // ---------------------------------------------------------------- styles

    var sectionStyle = { flexDirection: "column", gap: "14px", width: "100%", display: "flex" };
    var headStyle = { display: "flex", alignItems: "flex-start", flexDirection: "column", gap: "4px", padding: "2px 2px 0" };
    var titleStyle = { fontSize: 16, fontWeight: 600, color: "var(--dsw-alias-label-primary)", lineHeight: 1.4 };
    var introStyle = { fontSize: 13, color: "var(--dsw-alias-label-secondary)", lineHeight: 1.6, maxWidth: "720px" };
    var cardStyle = { boxSizing: "border-box", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", borderRadius: "14px", flexDirection: "column", gap: "8px", padding: "14px 16px", display: "flex" };
    var cardTitleStyle = { fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary)", lineHeight: 1.4 };
    var rowStyle = { display: "flex", alignItems: "flex-start", gap: "10px", padding: "6px 0" };
    var rowInlineStyle = { display: "flex", alignItems: "center", gap: "10px", padding: "6px 0" };
    var labelStyle = { display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: 0 };
    var nameStyle = { fontWeight: 500, color: "var(--dsw-alias-label-primary)", fontSize: 14, lineHeight: 1.4 };
    var descStyle = { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.5 };
    var checkboxStyle = { width: 16, height: 16, cursor: "pointer", accentColor: "var(--dsw-alias-brand-primary)", flex: "none", marginTop: 2 };
    var msgOkStyle = { fontSize: 12, color: "var(--dsw-alias-state-success-primary)", lineHeight: 1.5, wordBreak: "break-all" };
    var msgErrStyle = { fontSize: 12, color: "var(--dsw-alias-state-error-primary)", lineHeight: 1.5, wordBreak: "break-all" };
    var footStyle = { display: "flex", alignItems: "center", gap: "10px", padding: "2px", flexWrap: "wrap" };
    var inputStyle = { width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-2)", color: "var(--dsw-alias-label-primary)", fontSize: "13px", outline: "none", fontFamily: "inherit" };
    var selectStyle = { boxSizing: "border-box", padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-2)", color: "var(--dsw-alias-label-primary)", fontSize: "13px", outline: "none", fontFamily: "inherit" };
    var textareaStyle = { width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-2)", color: "var(--dsw-alias-label-primary)", fontSize: "13px", outline: "none", fontFamily: "inherit", minHeight: "64px", resize: "vertical" };
    var fieldStyle = { display: "flex", flexDirection: "column", gap: "6px", width: "100%" };
    var fieldLabelStyle = { fontSize: 13, color: "var(--dsw-alias-label-primary)", fontWeight: 500 };
    var phBoxStyle = { boxSizing: "border-box", border: "1px dashed var(--dsw-alias-border-l2)", borderRadius: "10px", padding: "10px 12px", background: "var(--dsw-alias-bg-layer-2)", fontSize: 12, color: "var(--dsw-alias-label-secondary)", lineHeight: 1.7, wordBreak: "break-all" };
    var twoColStyle = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" };

    // ---------------------------------------------------------------- api

    function api(method, payload) {
      return fetch("/wecom-notice/api/" + method, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload || {}),
        credentials: "same-origin",
      }).then(function (res) { return res.json(); }).then(function (body) {
        if (!body || body.ok !== true) {
          var msg = body && body.error && body.error.message ? body.error.message : "api error";
          var err = new Error(msg);
          throw err;
        }
        return body.value;
      });
    }

    // ---------------------------------------------------------------- fields

    function ToggleRow(props) {
      return createElement("div", { style: rowInlineStyle },
        createElement("input", {
          type: "checkbox",
          checked: props.checked === true,
          onChange: function (e) { props.onChange(e.target.checked); },
          style: checkboxStyle,
        }),
        createElement("div", { style: labelStyle },
          createElement("div", { style: nameStyle }, props.label),
          props.hint ? createElement("div", { style: descStyle }, props.hint) : null,
        ),
      );
    }

    function TextField(props) {
      return createElement("div", { style: fieldStyle },
        createElement("div", { style: fieldLabelStyle }, props.label),
        createElement("input", {
          value: props.value == null ? "" : String(props.value),
          type: props.type || "text",
          placeholder: props.placeholder || "",
          onChange: function (e) { props.onChange(e.target.value); },
          style: inputStyle,
        }),
        props.hint ? createElement("div", { style: descStyle }, props.hint) : null,
      );
    }

    function NumberField(props) {
      return createElement("div", { style: fieldStyle },
        createElement("div", { style: fieldLabelStyle }, props.label),
        createElement("input", {
          value: props.value == null ? "" : String(props.value),
          type: "number",
          min: props.min,
          max: props.max,
          step: props.step || 1,
          onChange: function (e) {
            var n = parseInt(e.target.value, 10);
            props.onChange(Number.isFinite(n) ? n : 0);
          },
          style: inputStyle,
        }),
        props.hint ? createElement("div", { style: descStyle }, props.hint) : null,
      );
    }

    function SelectField(props) {
      return createElement("div", { style: fieldStyle },
        createElement("div", { style: fieldLabelStyle }, props.label),
        createElement("select", {
          value: props.value,
          onChange: function (e) { props.onChange(e.target.value); },
          style: selectStyle,
        }, (props.options || []).map(function (opt) {
          return createElement("option", { key: opt.value, value: opt.value }, opt.label);
        })),
        props.hint ? createElement("div", { style: descStyle }, props.hint) : null,
      );
    }

    function TemplateField(props) {
      return createElement("div", { style: fieldStyle },
        createElement("div", { style: fieldLabelStyle }, props.label),
        createElement("textarea", {
          value: props.value == null ? "" : String(props.value),
          placeholder: props.placeholder || "",
          onChange: function (e) { props.onChange(e.target.value); },
          style: textareaStyle,
        }),
      );
    }

    // ---------------------------------------------------------------- section

    function WecomSection(props) {
      var t = props.t;

      var formState = useState(null);
      var form = formState[0];
      var setForm = formState[1];

      var loadErrState = useState(false);
      var loadErr = loadErrState[0];
      var setLoadErr = loadErrState[1];

      var msgState = useState(null);
      var msg = msgState[0];
      var setMsg = msgState[1];

      var busyState = useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];

      var savedSnapState = useState("");
      var savedSnap = savedSnapState[0];
      var setSavedSnap = savedSnapState[1];

      var applyConfig = useCallback(function (config) {
        setForm(config);
        setSavedSnap(JSON.stringify(config));
      }, []);

      var refresh = useCallback(function () {
        setLoadErr(false);
        api("get").then(function (value) {
          applyConfig(value.config || {});
        }).catch(function () {
          setLoadErr(true);
        });
      }, [applyConfig]);

      useEffect(function () { refresh(); }, [refresh]);

      var setField = useCallback(function (key, value) {
        setForm(function (prev) {
          var next = Object.assign({}, prev);
          next[key] = value;
          return next;
        });
      }, []);

      var setEvent = useCallback(function (key, value) {
        setForm(function (prev) {
          var next = Object.assign({}, prev);
          next.events = Object.assign({}, prev.events);
          next.events[key] = value;
          return next;
        });
      }, []);

      var setTemplate = useCallback(function (key, value) {
        setForm(function (prev) {
          var next = Object.assign({}, prev);
          next.templates = Object.assign({}, prev.templates);
          next.templates[key] = value;
          return next;
        });
      }, []);

      var dirty = form !== null && savedSnap !== "" && JSON.stringify(form) !== savedSnap;

      var doSave = useCallback(function () {
        if (!form) return;
        setBusy(true);
        setMsg(null);
        api("save", { config: form }).then(function (value) {
          applyConfig(value.config || form);
          setMsg({ kind: "ok", text: t("savedOk") });
        }).catch(function (error) {
          setMsg({ kind: "err", text: error.message });
        }).finally(function () {
          setBusy(false);
        });
      }, [form, applyConfig, t]);

      var doTest = useCallback(function () {
        if (!form) return;
        if (!form.webhook) {
          setMsg({ kind: "err", text: t("needWebhook") });
          return;
        }
        setBusy(true);
        setMsg(null);
        api("test", { config: form }).then(function (value) {
          setMsg({ kind: "ok", text: t("testOk") + (value && value.detail ? value.detail : "") });
        }).catch(function (error) {
          setMsg({ kind: "err", text: error.message });
        }).finally(function () {
          setBusy(false);
        });
      }, [form, t]);

      if (loadErr) {
        return createElement("div", { style: sectionStyle },
          createElement("div", { style: titleStyle }, t("nav")),
          createElement("div", { style: msgErrStyle }, t("loadErr")),
          createElement(Button, { variant: "outline", onClick: refresh }, t("retry")),
        );
      }

      if (!form) {
        return createElement("div", { style: sectionStyle },
          createElement("div", { style: titleStyle }, t("nav")),
        );
      }

      var ev = form.events || {};
      var tpl = form.templates || {};

      return createElement("div", { style: sectionStyle },
        createElement("div", { style: headStyle },
          createElement("div", { style: titleStyle }, t("nav")),
          createElement("div", { style: introStyle }, t("intro")),
        ),

        // ---- 基础配置
        createElement("div", { style: cardStyle },
          createElement("div", { style: cardTitleStyle }, t("basic")),
          createElement(ToggleRow, {
            checked: form.enabled !== false,
            label: t("enabled"),
            hint: t("enabledHint"),
            onChange: function (v) { setField("enabled", v); },
          }),
          createElement(TextField, {
            label: t("webhook"),
            value: form.webhook || "",
            placeholder: t("webhookPh"),
            hint: t("webhookHint"),
            onChange: function (v) { setField("webhook", v); },
          }),
          createElement(SelectField, {
            label: t("msgtype"),
            value: form.msgtype === "markdown" ? "markdown" : "text",
            options: [
              { value: "text", label: "text（微信插件可见）" },
              { value: "markdown", label: "markdown（企业微信客户端）" },
            ],
            hint: t("msgtypeHint"),
            onChange: function (v) { setField("msgtype", v); },
          }),
          createElement("div", { style: twoColStyle },
            createElement(NumberField, {
              label: t("debounce"),
              value: form.debounceMs,
              min: 0,
              max: 300000,
              step: 1000,
              hint: t("debounceHint"),
              onChange: function (v) { setField("debounceMs", v); },
            }),
            createElement(NumberField, {
              label: t("summaryMax"),
              value: form.summaryMaxChars,
              min: 20,
              max: 1800,
              step: 50,
              hint: t("summaryMaxHint"),
              onChange: function (v) { setField("summaryMaxChars", v); },
            }),
          ),
        ),

        // ---- 事件开关
        createElement("div", { style: cardStyle },
          createElement("div", { style: cardTitleStyle }, t("events")),
          createElement(ToggleRow, {
            checked: ev.turnEnd !== false,
            label: t("evTurn"),
            hint: t("evTurnHint"),
            onChange: function (v) { setEvent("turnEnd", v); },
          }),
          createElement(ToggleRow, {
            checked: ev.turnEndFail !== false,
            label: t("evTurnFail"),
            hint: t("evTurnFailHint"),
            onChange: function (v) { setEvent("turnEndFail", v); },
          }),
          createElement(ToggleRow, {
            checked: ev.approval !== false,
            label: t("evApproval"),
            hint: t("evApprovalHint"),
            onChange: function (v) { setEvent("approval", v); },
          }),
          createElement(ToggleRow, {
            checked: ev.agentError !== false,
            label: t("evError"),
            hint: t("evErrorHint"),
            onChange: function (v) { setEvent("agentError", v); },
          }),
        ),

        // ---- 模板
        createElement("div", { style: cardStyle },
          createElement("div", { style: cardTitleStyle }, t("templates")),
          createElement("div", { style: phBoxStyle },
            createElement("div", { style: fieldLabelStyle }, t("placeholders")),
            createElement("div", { style: descStyle }, t("phHint")),
          ),
          createElement(TemplateField, { label: t("tplTurnTitle"), value: tpl.turnEndTitle, onChange: function (v) { setTemplate("turnEndTitle", v); } }),
          createElement(TemplateField, { label: t("tplTurnBody"), value: tpl.turnEndBody, onChange: function (v) { setTemplate("turnEndBody", v); } }),
          createElement(TemplateField, { label: t("tplTurnFailTitle"), value: tpl.turnEndFailTitle, onChange: function (v) { setTemplate("turnEndFailTitle", v); } }),
          createElement(TemplateField, { label: t("tplTurnFailBody"), value: tpl.turnEndFailBody, onChange: function (v) { setTemplate("turnEndFailBody", v); } }),
          createElement(TemplateField, { label: t("tplApprovalTitle"), value: tpl.approvalTitle, onChange: function (v) { setTemplate("approvalTitle", v); } }),
          createElement(TemplateField, { label: t("tplApprovalBody"), value: tpl.approvalBody, onChange: function (v) { setTemplate("approvalBody", v); } }),
          createElement(TemplateField, { label: t("tplErrorTitle"), value: tpl.errorTitle, onChange: function (v) { setTemplate("errorTitle", v); } }),
          createElement(TemplateField, { label: t("tplErrorBody"), value: tpl.errorBody, onChange: function (v) { setTemplate("errorBody", v); } }),
        ),

        // ---- 操作
        createElement("div", { style: footStyle },
          createElement(Button, { variant: "primary", onClick: doSave, disabled: busy || !dirty }, busy ? t("saving") : t("save")),
          createElement(Button, { variant: "outline", onClick: doTest, disabled: busy }, busy ? t("testing") : t("test")),
          dirty ? createElement("span", { style: descStyle }, t("dirty")) : null,
          msg ? createElement("span", { style: msg.kind === "ok" ? msgOkStyle : msgErrStyle }, msg.text) : null,
        ),
      );
    }

    // ---------------------------------------------------------------- surface

    var inject = ["slots", "locale"];

    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "dsh-wecom-notice: locale");
      var t = ctx.locale.bind(NS);
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "dsh-wecom-notice",
          order: 61,
          label: function () { return t("nav"); },
          locale: NS,
          inject: function () { return { t: t }; },
        }, WecomSection);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
