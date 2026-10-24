# 给 Muse：v2 → v3 分页恢复补丁（2026-10-24）

本包只升级已安装的 v2 后台。不要重新使用最初 v2 安装说明或覆盖网页，不上传数据。

## 为什么继续等待或重复点重跑可能无效

v2 fetch() 在 HTTP 200 和基本 JSON 检查后先缓存，再由 iter_pages 检查跨页重复。
因此“失败页不会进入缓存”不准确；重复页可能已存盘。原 scope 再跑时可能完全读取旧缓存，不访问网络。
另外旧 blocked 队列不会因第二天定时触发而自动变 pending。因此“明早日常任务自然重试”也不准确。

截图不足以判断每一次真实运行是服务返回重复还是重放缓存，也不能证明整个OpenAlex服务全局漂移。
请区分 cache_hit、response、pagination_rejected 证据，不能用新探测健康替代原任务验收。

## 修复行为

- 继续逐ID、逐页、总数和游标校验，不跳重复ID，不跳组，不报假完成。
- 记录每个查询的请求哈希；异常时把该查询全部已取页放入 SQLite 的 invalidated_pages 保留原始证据，再从活跃缓存移出。
- 保留同scope其他查询的缓存、原队列窗口、原scope、全局额度/冷却状态、原数据和writer锁。
- 第一次分页一致性失败返回75、等待15分钟；第二次等待30分钟；第三次失败返回78并要求看证据。不无限循环重跑。
- 已知v2分页错误的blocked队列可在安装时明确恢复为pending；401/403、代码变更等其他blocked仍拒绝自动恢复。
- 新增 cache_hit / pagination_rejected 事件，区分读缓存与真正联网。

历史 history_reconcile.py 的独立ledger仍保留 needs_review 策略，此补丁修复的是三库每日运行的共享 iter_pages；不要声称它已自动修复所有历史查询。

## 执行

解压到新目录，使用这个目录内的 maintenance/。本补丁的 expected_before 是已经安装的v2哈希，不是10月22日更早的原始版本。

1. 先生成只读状态回执，不修改任何队列或额度：

```sh
python3 maintenance/inspect_pipeline.py --output before-pagination-v3.json
python3 -m unittest discover -s maintenance/tests -v
python3 maintenance/install_pipeline.py --workspace "$HOME/workspace" --accept-pending-replay
```

2. 短暂停用三库日常与续跑调度，等当前写锁释放；不能杀写库进程。预检必须返回0。如果哈希不符或非分页错误blocked，返回具体错误，不改安装器的允许名单。

```sh
python3 maintenance/install_pipeline.py --workspace "$HOME/workspace" --accept-pending-replay --execute
```

自动备份程序与原queue，升级12个文件，更新source指纹。仅识别到v2已知分页错误时恢复blocked为pending，保留原scope和日期窗口。

3. 恢复原四个调度任务。用无管道方式运行一次原队列：

```sh
python3 "$HOME/workspace/cold-lit-db/run_pipeline.py" --drain
pipeline_rc=$?
printf 'pipeline_exit=%s\n' "$pipeline_rc"
python3 maintenance/inspect_pipeline.py --output after-pagination-v3.json
```

不要加 --new-run，不删requests.sqlite3，不清空pages/队列，不重置额度，也不同时启动旧rewash。
第一次可能从旧缓存复现错误并隔离，而后返回75，按15分钟唤醒自动继续；不能把它当补丁无效。
若第三次一致性失败返回78，提供隔离页数、错误、qstat和回执，停止重复盲跑。

4. 回报 before/after JSON、安装回执、原始退出码、各查询已完成/未完成数、真实HTTP response数、cache_hit数及入库数。
“203组全尝试”和“203组全完成”必须分别报告。尚有195组not_started时不能写全尝试。
本包没有执行数据发布的授权步骤，也不包含要上传的分片。

## 公开分页依据

OpenAlex分页文档要求沿用next_cursor，并没有给出跨请求的不可变快照承诺：
https://help.openalex.org/api/paging/
本补丁仍需真实远端验收，不能保证每个变化中的查询都一次成功。
