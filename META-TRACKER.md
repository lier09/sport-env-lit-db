# Meta 选题追踪

独立入口：`#meta`，也可使用 `#meta?topic=cold-recovery`。首批 8 个方向是人工编辑的探索起点，不是全领域机会排名，也不是系统综述的正式检索策略。

## 更新候选快照

```sh
node scripts/build-meta-candidates.cjs /path/to/verified-corpus-directory
```

目录需包含 `manifest.json` 与 `papers-1.json` 至 `papers-4.json`。脚本校验每个分片 SHA256 和总数后，使用 `meta-rules.json` 的规则生成 `meta-topics.json`。发布新快照时更新 `meta-hub.js` 中快照 URL 修订，保持页面和离线外壳版本一致。快照不应加入 Service Worker 预缓存。

初始快照来自 54,308 条记录，源版本 `5bcb5c14e07f8366fe7d`，生成时间为 2026-10-19 07:05（北京时间）。快照只含候选 ID、匹配字段和命中词、类型线索；摘要复用已载入的文献数据，不复制完整摘要或 PDF。

每个规则组必须至少有一个词在标题或摘要中命中。大小写、Unicode 兼容形式与常见连字符做归一化。按 DOI（无 DOI 时按 ID）去重，仅能避免一部分记录重复，不能证明报告间样本独立。综述类型仅依据标题及原有标签，未标为综述的记录仍需核对原始研究设计、人群及数据。

## 追踪与个人资料

- “追踪方向”将当时的候选 ID 作为已读基线。
- 点击“扫描当前库”重新匹配当前浏览器已载入的整个库，按 300 条分批处理；不访问外部 API，不获取全文。
- 新增指较基线出现的新候选 ID，不表示新发表，也不证明是新的独立试验。
- 扫描结果仅本次会话保留，个人已读基线、筛选判断、研究编号和备注持久保存在 `litdb-meta-tracker`。重新打开网页后可再扫描；系统不会在后台持续扫描或推送提醒。
- 取消追踪不删除人工记录；人工排除不删除库内文献。当前清单按 20 条分页，CSV 导出覆盖筛选后的全部记录。
- “导出个人备份”使用现有账号资料备份（排除 AI 密钥）。可在文献库个人资料导入入口恢复；同一浏览器不同账号隔离，无云同步。

## 科学边界

PICO、不同结局和时间点的分组提示参考 [Cochrane 第 3 章](https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-03) 与 [第 10 章](https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-10)，选题草案为本项目编辑内容。

词项命中会漏检和误检；必须补充外部数据库检索，人工核查已有综述及其检索截止时间、报告对应的独立队列、研究偏倚、数据可提取性及可比性。界面不根据文献量生成“可发表”“创新性”或“适合合并”的评分。
