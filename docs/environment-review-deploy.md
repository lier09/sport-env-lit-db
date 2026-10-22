# 公共环境审核部署（交给 Muse）

前端已有“待核查”、逐篇及批量多环境归类、退回待核查。公共写入默认关闭，避免尚未部署时假装保存成功。所有访客读取同一份公共分类；修改仅限指定管理员。个人笔记和收藏不迁移到云端。

## 部署顺序

1. 拉取仓库最新 main，保留其他人的更新。不要用旧 index.html 覆盖首页。
2. 在目标 Supabase 项目 `ywmjbivuibxsgjcmekob` 的 SQL Editor，以项目管理员执行 `supabase/migrations/202610220001_environment_reviews.sql`。只执行这份迁移。
3. 在 Auth 用户列表找到用户现有注册账号，取得 UUID。由 Muse 核实身份并设置 Edge Function secret `ENV_REVIEW_ADMIN_IDS` 为该 UUID（多个用英文逗号分隔）。不要公开邮箱、UUID清单、密码或管理密钥。不要把所有注册用户设为管理员。
4. 部署单个函数：`supabase functions deploy environment-review --project-ref ywmjbivuibxsgjcmekob`。保持 `verify_jwt = true`，不要加 `--no-verify-jwt`。平台内置的 SUPABASE_URL、SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY 仅供服务器使用。默认允许网页来源 `https://lier09.github.io`；如需其他域名，通过 `ENV_REVIEW_ALLOWED_ORIGINS` 英文逗号分隔配置。
5. 运行下一节实际后端验收。通过后，只把 `environment-review-config.json` 中 `enabled` 改成 `true`，提交该配置到最新 main，等待 Pages 发布。不得提前开启，也不必改 PDF 服务。

## 必须在真实项目执行的验收

- 在 SQL Editor 执行 `supabase/tests/environment-review.sql`：验证幂等、冲突整批回滚、匿名只读和私人历史不可读，末尾 ROLLBACK 不留测试数据。此脚本尚未在本地 PostgreSQL 执行，不能用 JS 测试代替。
- 无 JWT 请求函数被拒绝；普通真实注册用户请求返回 403；指定管理员 GET 返回 `can_review: true`。不要用公开 anon JWT 冒充用户身份。
- 普通访客只能读取 paper_id、environments、revision、updated_at。直接写表、调用审核 RPC、读取 reviewer_id、历史表或请求表都必须失败。
- 管理员选一篇真实待核查文献，核对内容后归入正确环境。刷新后另一浏览器无需登录也看到相同分类。核查备注和审核者身份不应出现在公共响应。
- 同一 revision 重复修改出现 409；不应覆盖别人刚确认的结果。退回待核查需再确认并产生新 revision。
- 只有这些验收全部通过，才开启前端配置。记录部署版本和验收结果。

## 数据约定与限制

审核结果是独立公共覆盖层，不修改、重建或上传原始文献分片。相同 OpenAlex ID 的后续分片更新仍使用人工分类；全量重洗脚本本身暂不读取这张表。网页刷新或“刷新公共分类”后同步，不是实时推送。

七个科学环境不含“待核查”；空、未知、待分类环境统一进入待核查，普通搜索默认不包含它们。“其他环境”是一个明确分类，不等同于待核查。已有主题标签不能证明环境已经审核过。

每批最多200篇，修改会替换这些文献的环境集合，允许多选。不支持以无 OpenAlex ID 的本机导入文献写入公共库，不提供公共删除功能。首次审核的原始环境来自网页数据，审计历史保留此值；后续历史由数据库取得上一版。审核记录分页读取，不保证读取期间其他管理员修改的快照一致性，可刷新获取最新状态。

回滚：把前端配置 enabled 改回 false 可停止网页公共回写；不要删除审核表或历史。已打开的页面需刷新。需要彻底撤销权限时同时移除管理员 secret 中的 UUID。
