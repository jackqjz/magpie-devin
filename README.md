# jackqjz/magpie-devin

本人维护的 Magpie Devin 插件，基于上游 0.1.27，保留已验证的本地修复，并选择性移植了上游 0.1.28、0.1.29、0.1.32、0.1.36、0.1.37 的改动（已审查到 0.1.37）。包名为 `@jackqjz/magpie-devin`；供应商 ID 保持 `devin`，账号仍由 Magpie 的原供应商存储管理。

## 修复

保留原始 thinking、signature 和 origin，覆盖签名晚于可见文字到达的情况。Claude 在 Magpie 边界使用 Anthropic Messages，SWE-2 使用 Responses；上游继续使用 Connect/Protobuf。SWE 的本地状态封装与账号绑定，支持进程重启。鉴权使用本人原生 CLI 抓包验证的形式。

Claude 的 Messages 请求按 Devin CLI 的形态发送（对照本机 CLI 3000.11.3 和 Devin 桌面内置 CLI 3000.11.234 的抓包）：

- system 与 user 的每个文本块各自成为一条 prompt，不再合并成一条；
- 客户端标了 `cache_control` 的块写入 `prompt_cache_options {type: 1}`（字段 8），与新版 CLI 的编码一致；
- 失败的 `tool_result` 在文字前加 `Error:`（上游 0.1.29），Devin 没有失败标记字段；
- 与上游 0.1.28 不同，签名 thinking 继续原样回传，不丢弃。

上游 0.1.30 的缓存保活没有移植：上游默认关闭、每次保活计费，本机 CLI 抓包中也没有观察到保活请求。

运行文件 SHA-256：`38b34ef37e4cf2a41cae2412096665414615ad9902a262a127adc2bedef051fe`。

## 0.1.37-jackqjz.2 更新

修复 Cindy / Claude Code 切换模型时的 `Couldn't confirm model`：Claude Code 用 `max_tokens: 1` 验证模型，Devin 有时消耗该 token 后以长度上限结束但不返回可见文本。旧版把这种正常响应当作空回复错误，触发网关重试，最终验证超时。

仅在 Messages 请求明确限制为 1 token、Devin 明确返回长度上限且记录恰好 1 个输出 token 时，保留真实的 `max_tokens` 结束状态及 usage。未增加输出预算、未伪造回复；其他空回复和上游错误仍照常拒绝。

## 0.1.37-jackqjz.1 更新

- 对话中途的 system/developer 通知保留位置和缓存标记，等待工具结果结束再发送。
- 非 Claude 的完整无签名 reasoning 可以回传；拆分的工具调用保留各自思考文本，已有签名不被替换。
- SWE-2 Flash 使用独立模型 ID 和 Responses 接口。原生无签名思考以独立、按账号加密的本地状态保存；回传仅发送原文，不伪造 signature/origin，也不把客户端摘要当作完整思考。
- 更新 11 月 5 日模型快照；模型图片能力优先采用账号实时配置。Flash 的静态后备值与上游实际源码一致，为仅文本。
- 保留既有签名回传和流式实现，缓存保活仍不启用。

免费档位及到期路由属于本机配置，不硬编码在公共插件中。本机目前只选 SWE-2 High（2026-12-01 前）和 SWE-2 Flash Medium（2026-12-05 前），具体免费待遇应以账号为准。

## 安装

从 GitHub 直接安装，不需要 npm 发布。日常使用固定到验收通过的完整 commit：

```sh
magpie plugin add 'github:jackqjz/magpie-devin#<完整commit>'
magpie plugin use '@jackqjz/magpie-devin' devin
```

切换前备份插件配置与原包；启用此版本后停用原来的 devin 插件，避免两个实现争用同一供应商。保留原供应商账号，不执行退出登录或删除账号。停用上游包不代表删除原账号。

## 验证

```sh
python3 scripts/test.py
```

需要 Bun 1.4.4、Node.js 24 和 Python 3。也可用环境变量 `BUN_BINARY` 指定本机 Bun 的可执行文件。测试使用临时用户目录及合成数据，不读取真实登录文件。

已完成的原生与代理验收范围：Devin SWE-2 High、Claude Opus 5.5 High。包含工具调用、报错恢复、第二轮用户消息及代理进程重启后的状态回传。详见 [VALIDATION.md](./VALIDATION.md)。

## 比较上游更新

```sh
python3 scripts/compare-upstream.py
```

该命令读取 UPSTREAM.json 中记录的来源，下载到本地专用 review refs，展示上游自基线以来的变化，以及当前已提交运行文件与最新上游的差异。它不修改 main、工作区或安装配置，也不会自动合并或发布。

采用更新时，新建分支审查并移植变更，更新 UPSTREAM.json，运行离线测试和实际工具闭环验收。通过后提交、打标签，再将 Magpie 的安装来源改为新的完整 commit。仅更新自己的 main 不会改变固定 commit 的安装。

## 许可

[MIT](./LICENSE)。上游版本、提交及目录见 [UPSTREAM.json](./UPSTREAM.json)，来源声明见 [NOTICE.md](./NOTICE.md)。本仓库不包含账号、请求抓包或真实推理签名。
