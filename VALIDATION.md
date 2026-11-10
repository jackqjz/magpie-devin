# 验证记录

2026-10-31 已对 Devin SWE-2 High、Claude Opus 5.5 High 完成真实原生路径与 Magpie 路径对照。每个模型各包含两轮订单工具任务，检查实际输出文件、工具回传及原始推理状态；代理在两轮之间重启后继续成功。

本仓库保留上游离线回归测试和修复专项测试；真实抓包只在本机私有目录中比较，未上传。当时的运行文件 SHA-256：`2dda26aed9b95445e77fe12b94d95cc71867f7e169d61b17e3fb82fc9cb67e43`（0.1.27-jackqjz.1）。

建仓检查：上游 Bun 回归 147 项通过，修复专项 Node 测试 33 项通过。上游公开的 testdata 样例原样保留；OpenCode 消息映射和账号切换的两个旧断言已更新，以覆盖新增的 signed metadata 以及经原生 CLI 验证的鉴权格式。运行文件没有因此改变。

验收证明上述已观察路径的兼容性。不同 agent 的工具定义、系统提示、客户端头和元数据仍可能不同，不能据此声称与原生软件逐字节一致或保证账号风险为零。其他模型及长上下文压缩没有纳入本次支持范围。

Devin 的外部 Anthropic redacted_thinking 历史尚无已验证映射，插件明确拒绝该输入。普通 Chat 客户端需自行保留扩展的 signed metadata。

## 2026-11-01：0.1.27-jackqjz.2（移植上游 0.1.28–0.1.29）

运行文件 SHA-256：`b70f42cf27549e7e08464a2ea5902f86ddf754ac4229395e0a124eeccd074de1`。离线测试：Bun 158 项、Node 33 项通过，新增 messages-cache.test.mjs。

真实验收在隔离的 Magpie 网关（同版本官方二进制、私有配置、只含 Devin 登录）上进行，生产网关未重启。Codex 订单工具任务，均为 3 次工具调用、结果文件正确、输出 VERIFIED：

- Claude Opus 5.5 High 三次通过；SWE-2 High 一次通过（SWE 路径未改动，作为回归）。
- 抓包核对：Claude 请求开头为 5 条独立 user prompt（旧版为 1 条合并的 prompt；新版 CLI 为 4 条）；缓存标记位于静态指令 prompt 和最后一条消息，尾部标记随轮次前移，与新版 CLI 的模式一致；每轮都把之前的签名 thinking 连同原文和 origin 放在同一条 assistant 消息中回传。
- 缓存（同一任务、缓存有效时）：新版每次任务首轮之后的缓存写入约 276 token，旧版约 52,300 token；整次任务缓存写入从约 10.2 万降到约 4.9 万。新前缀结构第一次使用时会有一次冷写入。

限制：Codex 的失败命令以普通输出返回，不会触发 `is_error`，`Error:` 前缀只由离线测试覆盖。请求不是与 CLI 逐字节一致（指令放在 user prompt 而非 CLI 的 system 字段，未发送 CLI 的字段 2/15/16/20/22/28 等）。

## 2026-11-10：0.1.37-jackqjz.1

运行文件 SHA-256：`73cabe7831d8d43b0f493fe4a9e1fcbb91d73bfd74e8008ef295493e40f4cec9`。

- 离线测试：Bun 168 项、Node 36 项通过。覆盖中途通知位置、缓存标记、并行及中断工具结果、非 Claude 无签名思考、混合签名块、Flash 模型选择、流式和非流式 Responses 无签名状态回传、跨账号及状态类型篡改拒绝。
- 本机配置另通过 98 个档位、协议、到期边界和路由图场景；包含不经过请求中间件的内部分类器图。该配置不随公共插件发布。
- 使用更新后的插件 loader 对真实 Devin 进行两轮合成工具任务：SWE-2 High、SWE-2 Flash Medium、Claude Opus 5.5 High 均调用指定工具并正确返回验证结果。
- 出站 Protobuf 模型字段确认分别为 `swe-2-high`、`swe-2-flash-medium`、`claude-opus-5-5-high`，没有调用 SWE 的其他档位。
- SWE-2 第二轮回传签名思考；Flash 第二轮回传原生完整思考而不添加签名。Claude 本次短任务没有返回 thinking，因此 Claude 签名回归由离线测试及先前验收记录覆盖，本次真实测试验证工具闭环和中途通知。
- 验证只公开模型 ID 和汇总；不发布登录信息、真实推理文本、签名或请求抓包。
