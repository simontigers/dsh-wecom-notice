# dsh-wecom-notice

DeepSeek Harness 插件：**企业微信群机器人通知**，消息文本完全自定义。

agent 回合结束、需要你批准工具调用、执行出错时，按你定义的模板渲染标题和正文，推送到企业微信群机器人。支持占位符、text/markdown 消息类型、事件独立开关、同会话防抖合并，并在 DSH 设置页提供可视化配置与一键测试。

## 功能

- **三种事件**：回合结束（成功/异常可分别开关与模板）、审批请求、Agent 出错
- **自定义模板**：每个事件独立的标题/正文模板，占位符渲染
- **占位符**：`{workspace}` `{session}` `{sessionId}` `{summary}` `{tool}` `{reason}` `{error}` `{kind}` `{time}` `{date}`
- **消息类型**：`text`（个人微信的"微信插件"里也能看）/ `markdown`（企业微信客户端）
- **防抖**：同一会话短时间内多次回合结束只推送最后一条（可配，0 关闭）
- **去重**：会话事件重放（如重启）不会重复推送
- **设置页 UI**：DSH 设置页内直接编辑全部配置，测试发送用当前表单值、无需先保存
- **服务接口**：其他插件可 `ctx.get('wecomNotice').send({ title, content })` 直接推送

## 安装

### 从本地目录

```sh
dsh plugin --profile web add /path/to/dsh_wecom_notice
```

### 从 GitHub（无需构建：纯 ESM，无 prepare 脚本）

```sh
dsh plugin --profile web add github:you/dsh-wecom-notice
# 建议锁定 commit：
dsh plugin --profile web add github:you/dsh-wecom-notice#<sha>
```

安装后重启 `dsh web` 生效。

## 配置

打开 DSH Web UI → 设置 → **企业微信通知**：

1. 粘贴群机器人 Webhook（企业微信群 → 群设置 → 群机器人 → 添加）
2. 选择消息类型：想在**个人微信**的微信插件里收到就选 `text`
3. 按需开关事件、改模板
4. 点 **测试发送** 验证 → **保存**

配置持久化在 `$DSH_HOME/wecom-notice/config.json`。

### 默认模板

| 事件 | 默认样式 |
| --- | --- |
| 回合完成 | `╔═╗` 卡片头 `✅ 任务完成通知` ＋ 工作区/任务ID/时间/状态 ＋ 执行摘要 |
| 回合异常 | `╔═╗` 卡片头 `⚠️ 任务异常通知`，状态行显示 `{kind}` |
| 审批请求 | `╔═╗` 卡片头 `🔐 审批请求通知` ＋ 工具/原因 ＋ 当前回复 |
| Agent 出错 | `╔═╗` 卡片头 `❌ Agent 出错通知` ＋ 错误信息 |

卡片用制表符排版（`╔ ═ ┈`），`— DeepSeek Harness` 签名收尾；均可在设置页改。
长文本（摘要/错误）按 2048 字节消息上限动态截断，保证卡片尾部完整。未知占位符会原样保留，方便发现拼写错误。

### 占位符

| 占位符 | 含义 |
| --- | --- |
| `{workspace}` | 工作区目录名 |
| `{session}` | 会话短 ID（8 位） |
| `{sessionId}` | 会话完整 ID |
| `{summary}` | 最后一条助手消息摘要（受"摘要最大长度"钳制） |
| `{tool}` | 审批涉及的工具名 |
| `{reason}` | 审批原因 |
| `{error}` | 错误信息 |
| `{kind}` | 回合结束类型（completed/blocked/error/interrupted…） |
| `{time}` / `{date}` | 本地时间 / 日期 |

## 编程接口

其他插件（如定时任务）可以直接调用：

```js
const notifier = ctx.get('wecomNotice')
await notifier?.send?.({ title: 'cron 完成', content: '任务 xyz 已跑完' })
```

## 说明

- 无第三方运行时依赖（Node 内置 fetch）
- 客户端设置页挂载方式参考了 [chicheng-push](https://github.com/534119219/chicheng-push)（MIT）与官方 dsh-cost-meter
- API 仅接受本机回环/受信 Host 的同源请求

## License

MIT
