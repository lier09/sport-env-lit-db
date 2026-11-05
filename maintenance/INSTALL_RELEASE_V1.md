# 已审核数据发布收尾程序

目标：接在现有“抓取 → 审核”之后执行发布及线上核验，不替换 v4 抓取程序，不重建任何网页，不自动判定论文合格。当前仅支持总库四分片；共识库和建模库不能用此程序发布。

## 安装与连接

1. 将 `publish_reviewed.py` 放在后台 maintenance 目录。运行包内测试：`python3 -m unittest discover -s tests -p test_publish_reviewed.py -v`。
2. 保留现有每日抓取和 15 分钟续跑。把“窗口完成后审核”加入现有任务正文；当天窗口未完成时，也应处理之前已完成的窗口，不要让新窗口阻塞旧窗口发布。
3. 审核后只将通过的记录放进暂存分片。待核查记录保留在私有清单，不能混入。所有旧记录保留；环境人工审核覆盖层保持不动。此程序允许逐条审核的字段更新，但拒绝删除旧记录、改变旧摘要。
4. 暂存目录放 `baseline-manifest.json`（当前线上原始字节）、`manifest.json`、`papers-1.json` 至 `papers-4.json`、`review.json`。只读核验命令：

   `python3 maintenance/publish_reviewed.py --release /absolute/staged-release --lock /absolute/shared-publish.lock`

5. 核验通过后，同一命令加 `--execute`。由已有运行环境安全提供 `SUPABASE_SERVICE_ROLE_KEY`，不要写入包、日志或聊天。所有发布者必须共用同一发布锁；停用旧的绕过锁的发布途径。锁文件因进程崩溃遗留时，先确认没有发布进程再移除，不能盲删。
6. 将这条命令接到审核任务完成后的最后一步。抓取任务不应直接发布未经审核的本地 merged.json。首次安装请返回测试结果、命令退出码和 `publish-receipt.json`；以后只有 `published_verified` 才报告上线。失败保留暂存目录和旧线上版本，修正后重复执行同一命令即可。

不需要每天再向用户索要同一类发布许可；按已授权的纳入标准审核通过后执行。规则变化、删改旧论文正文等超出范围的操作另行处理。

## review.json 合约

```json
{
  "format": "litdb-reviewed-release-v1",
  "reviewed_by": "审核者标识",
  "reviewed_at": "ISO 时间",
  "base_manifest_sha256": "baseline-manifest.json 的 SHA256",
  "target_manifest_sha256": "manifest.json 的 SHA256",
  "windows": [{"campaign": "实际 campaign ID", "coverage_complete": true, "unapplied_leaves": 0, "pending_tasks": 0}],
  "hold_ids": ["W123"],
  "changes": [{"id": "W456", "decision": "pass", "reason": "按摘要和纳入标准的具体审核依据", "before_sha256": null, "after_sha256": "record_hash 返回值"}]
}
```

窗口状态必须从当前 ledger 导出并核对，不能手写 true 来绕过。这里的窗口状态和审核理由是执行端的审核凭据，程序不能独立证明科学判断正确，也不直接读取运行中的 SQLite。

每个新增或修改记录都需一条 decision。ID 使用 `W数字`。新增 before_sha256=null；更新 before_sha256 对应线上旧记录。使用本模块 `record_hash(record)` 计算规范 JSON 哈希，不要使用普通 json.dumps 的默认格式。暂缓 ID 不允许出现在本次变更中。已经在线、未变更的历史待核查记录不会被擅自删除。

目标 manifest 的 version 必须是四个分片 SHA256 顺序拼接后再取 SHA256 的前 20 位。manifest.shards 路径格式为 `versions/<version>/papers-N.json`。分片和清单均按原始字节计算哈希。

## 发布行为与边界

- 默认只核验，不上传。生产执行需 `--execute`，安装包不会自动运行。
- 下载并验证基线四分片，逐条比对变更与审核凭据。
- 上传四个新版本分片并回读验证，再复查当前基线，最后切换 manifest；旧分片保留用于回滚。
- 切换后再回读清单和全部四分片，通过后才写本地 published_verified 回执。
- 如果最后一步网络失败，线上可能已切换但尚未确认。再次执行会验证目标版本并补写回执，不重复上传。
- Supabase Storage 没有在此使用原子 compare-and-swap；所有写入者遵守共享锁是前提。未经锁的外部发布仍可能造成竞态。
- 不上传私有审核清单、账户信息和密钥。不修改前端、个人资料、环境审核表、抓取额度或调度状态。
- 独立文件备份需用户在网页中选择目录授权。网页关闭时不能承诺每天备份；看图识记的 PDF/图片仍需在该模块独立导出。
