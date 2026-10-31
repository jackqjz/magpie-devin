# 来源与维护方式

本仓库是 jackqjz 维护的独立修复版本。原始 MIT 许可和版权声明保存在 LICENSE；上游说明保存在 UPSTREAM_README.md。准确基线见 UPSTREAM.json。

上游：https://github.com/magpie-community/plugins.git，目录 `packages/devin`。

本仓库只对 push/PR 运行离线测试；更新需人工审查、合并、验收并修改 Magpie 的固定 commit。provider id 保持 `devin`，同一供应商只启用一个插件实现。
