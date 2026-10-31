# jackqjz/magpie-devin

本人维护的 Magpie Devin 插件，基于上游 0.1.27，保留已验证的本地修复。包名为 `@jackqjz/magpie-devin`；供应商 ID 保持 `devin`，账号仍由 Magpie 的原供应商存储管理。

## 修复

保留原始 thinking、signature 和 origin，覆盖签名晚于可见文字到达的情况。Claude 在 Magpie 边界使用 Anthropic Messages，SWE-2 使用 Responses；上游继续使用 Connect/Protobuf。SWE 的本地状态封装与账号绑定，支持进程重启。鉴权使用本人原生 CLI 抓包验证的形式。

运行文件 SHA-256：`2dda26aed9b95445e77fe12b94d95cc71867f7e169d61b17e3fb82fc9cb67e43`。维护本仓库时没有改变已验收的运行代码。

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
