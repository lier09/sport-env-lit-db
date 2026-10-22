# Muse 执行：三库审计修复 v2

## 边界

此包安装后台程序和本地字段修复，不上传数据、不部署 HTML、不改 Supabase 审核表、不删除旧论文。
保留当前网页、PDF、关注和备忘录。只在现有 Muse VM 内执行；不要把本地 Windows 队列/SQLite 快照导入 VM。

## 1. 测试和预检

解压包后，在含 `maintenance/` 的目录运行：

```sh
python3 -m unittest discover -s maintenance/tests -v
python3 maintenance/install_pipeline.py --workspace "$HOME/workspace"
```

若预检报告未完成的队列，查看实际命令、窗口、状态。补丁需要重放原始下载页，保留原 scope/window/retry_at，不重置额度。确认后可以加 `--accept-pending-replay`。

若任一现有文件哈希不同，停止并导出差异给 Codex；不要强行覆盖。若旧 rewash 有待执行队列，先停用旧重洗调度，并备份、归档该队列后再预检。**不要归档日常增量队列。**

## 2. 安装

短暂暂停三库及续跑的调度，确认没有写库进程。安装程序仍会获取同一 enqueue/writer 锁；拿不到锁就退出，不杀进程。

```sh
python3 maintenance/install_pipeline.py --workspace "$HOME/workspace" --accept-pending-replay --execute
```

它核对12个文件，保存原文件/待续跑队列到 `~/workspace/pipeline-backups/<时间>/`，再替换程序。保留密钥、额度时钟、所有下载页和原队列窗口。安装回执不等于在线采集验收。

## 3. 修复当前本地记录字段

先只生成副本和差异清单：

```sh
python3 maintenance/normalize_corpus.py \
  --input "$HOME/workspace/cold-lit-db/data/merged.json" \
  --output "$HOME/workspace/schema-review-current.json"
```

审核 `.repairs.json`。交接快照预计8条有确定格式问题：7条 env 字符串→列表，并补标准 type/cited/unknown population/historical 字段；另1条中文 population→human。实际当前状态可能变化，按当前差异验收，不强求8条。
不会猜测缺失摘要、人群或环境，不改论文身份、正文或篇数。

确认差异全为格式修复后，使用新的输出文件名应用：

```sh
python3 maintenance/normalize_corpus.py \
  --input "$HOME/workspace/cold-lit-db/data/merged.json" \
  --output "$HOME/workspace/schema-applied-current.json" --apply
```

应用时再次取得 writer 锁，并自动校验备份。不将整个54,402条快照直接上传。

## 4. 真实运行验收

恢复三库每日任务和原15分钟队列唤醒，均只调用 `run_pipeline.py`。旧 collect.py 入口已禁写，旧 rewash 保持停用。每日任务仍优先。

```sh
python3 "$HOME/workspace/cold-lit-db/run_pipeline.py" --status
python3 "$HOME/workspace/cold-lit-db/run_pipeline.py" --drain
```

75=pending，78=blocked；不得将二者报告为“全过”。额度冷却未到时等待，不重置状态、不换身份绕过。无未完成队列时，可经审核用 `--job litdb --new-run` 做一次新的本地验收。
报告实际在线请求/页数、完整查询组数、pending/blocked、入库数、待核查数、watermark、是否仅数据变化；确认 build.py/site/index.html 均未变化。

然后运行高氧历史补漏的有界小批次：

```sh
python3 "$HOME/workspace/cold-lit-db/history_reconcile.py" \
  --workspace "$HOME/workspace/cold-lit-db" \
  --ledger "$HOME/.local/state/litdb-openalex/history-v2-high-oxygen.sqlite3" \
  --env 高氧 --pages 8 --rolling
```

新规则对应新 ledger，保留旧证据。只有原 `--drain` 返回0且任务空闲时，15分钟唤醒才可接续历史小批次。全环境另建新 ledger，当前196配置+7同义补充共203组。查询数量不代表历史覆盖已完成。

候选先补摘要、查关系并审核；历史补漏不能计入“每日新增”。原始待纳入队列与网页里的环境待核查不是同一个队列，目前不能承诺它已自动出现在网页。

## 5. 单篇论文发布另行执行

使用此v2包的 `release-54309-v2/`，版本 `cf69c3b7fc4f88e39344`，不要使用旧版zip的分片。
其基线为 `5bcb5c14e07f8366fe7d` /54,308；重新读取线上manifest，若已变化必须重建。
该包的4个分片需先上传不可变version路径、逐片下载核对SHA256/字节/篇数，再最后切manifest。保留旧manifest并保持单一发布者。
本包没有上传令牌，也不自动发布待审批次。发布后搜索 DOI `10.1007/s00421-025-05997-7` 并启用人类筛选，核对完整1953字符摘要。

## 6. 回报

提供安装回执、实际文件哈希、格式修复差异、真实运行qstat和状态，不回传任何密钥。
如果不能完成，报告具体阻塞、原数据是否恢复、下次续跑时间；不能笼统说“都好了”。
