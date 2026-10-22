# PDF 获取服务：交给 Muse 的部署步骤

## 当前状态

已完成后端函数、前端接入和自动测试，并通过本地通用函数真实获取冷水浸泡 Meta 分析 PDF。
前端默认 `pdf-service-config.json.enabled=false`。代码上线不代表 Supabase 函数已部署，不可提前宣布全部论文可读。
不更改文献数据、RLS、用户账户、数据库表或个人资料；不下载整库 PDF。

## 1. 使用最新仓库部署

在有该 Supabase 项目部署权限的环境执行。使用已有受信 CLI 登录，不在聊天、Git、日志或命令行参数中粘贴管理令牌。

```bash
git pull --ff-only
supabase functions deploy pdf-reader --project-ref ywmjbivuibxsgjcmekob
```

部署源文件：

- `supabase/functions/pdf-reader/index.ts`
- `supabase/functions/pdf-reader/service.mjs`
- `supabase/config.toml` 中仅该函数的 `verify_jwt=true` 配置

如果使用现有其它 Supabase 工程，合并这段函数配置，不要覆盖其它函数、项目配置或 secrets。
不得添加 `--no-verify-jwt`。目前网站已有该项目的公开 legacy anon JWT；请求仅用它通过网关验证，不需要 service_role。
网站公开访问不变，用户不需要注册/登录。这个公开 anon JWT 不是防滥用凭证，不能把它描述为用户身份验证。

如果没有项目部署权限或无法通过网关，应如实报告，不开启前端开关、不修改签名密钥或全局认证策略。

## 2. 可选配置

默认允许来源为 `https://lier09.github.io`。如需增加正式域名，在 Supabase 函数环境变量中设置 `PDF_ALLOWED_ORIGINS`（逗号分隔的完整 origin，不含路径）。

默认不配置 OpenAlex 密钥。函数优先查 Crossref 的开放许可和出版社公开链接；只有找不到时才查 OpenAlex 的 OA locations。
如果需要提高后端 OpenAlex 额度，可在项目 secrets 中设置 `PDF_OPENALEX_KEY`，但不得复用浏览器传来的 Key，不把密钥写入源码或公共配置。不要在用户未同意的情况下购买套餐或充值。

## 3. 必须先做真实部署验收

在最新网页仓库根目录执行（Node.js 22+）：

```bash
node scripts/check-pdf-service.cjs
```

脚本只使用网页中已经公开的 anon JWT，不读取管理密钥。检查：

- 预检 CORS 正常。
- 不带 JWT 的请求被网关拒绝。
- 任意 URL 输入被函数拒绝。
- 三个不同 DOI 返回真正 `%PDF-` 文件、正确 DOI、来源头和协议版本。

任何一步失败，不得启用。查看函数日志时只报告 HTTP 状态和错误代码，不输出 Key、完整签名 URL 或管理凭证。
如果因真实来源网络波动/限流失败，等候后人工重新验收；不要绕过检查强行打开开关。

## 4. 验收通过才启用

```bash
node scripts/check-pdf-service.cjs --enable
git diff -- pdf-service-config.json
git add pdf-service-config.json
git commit -m "Enable verified on-demand PDF service"
git push
```

只提交开关变更，不替换 index.html、不覆盖 Codex 最新功能、不生成整库新分片。
该配置在每次需要时走网络，service worker 不缓存它，开启不依赖另一轮 shell 版本升级。
部署后在真实网页里用未加入本地 PDF 副本目录的冷水浸泡论文验收，点击“阅读 → 原版 PDF”，确认页数、第一页及翻页；记录线上截图。

## 5. 设计和限制

- 前端优先用已有开放副本、可直读 PDF；失败后向服务 POST DOI/Work ID，关闭窗口会取消前端请求。网页全文/摘要、上传本地 PDF 和外链继续保留。
- 只接受 DOI/Work ID，拒绝客户端指定 URL。后端核验 Crossref DOI 与当前生效的 CC 许可，或 OpenAlex 同篇论文的明确 OA location，再取 PDF。
- HTML 仅用于读取出版社 citation_doi/citation_pdf_url 元数据，必须匹配 DOI；不把来源 HTML 注入阅读页面。
- 每一步重定向都核验 HTTPS 和预定义出版商/仓储域名，不访问私网、任意主机、携带用户凭据的 URL 或未知域名；没有登录、验证码或付费墙绕过逻辑。
- 最大 PDF 25 MB，元数据/HTML 2 MB，整次上游处理约 28 秒；HTTP 错误、HTML 登录页、假 PDF、过大文件、来源不支持会明确失败，不伪装成全文。
- 不持久化 PDF，也不把用户浏览器的 OpenAlex Key 或 Supabase JWT 传给出版社。服务端自己的可选 OpenAlex Key 仅发给 api.openalex.org。
- 关闭前端窗口会中止客户端读取；平台是否及时把断开传播到 Edge 请求的 signal 取决于运行时，后端还有总超时保护。
- 当前域名清单覆盖 Frontiers、PMC/Europe PMC、PLOS、MDPI、BMC/Springer、Nature、eLife、PeerJ、OUP、Wiley、ScienceDirect 等登记来源；具体仍受来源可达性、反自动访问策略和许可限制。未知仓储需要审查后加域名，不代表整库或所有开放论文都已支持。
- DOI 级来源核验不是对二进制内容的学术鉴定；PDF 由登记来源返回，保留 DOI 与最终来源供用户核对。
- 内存限流是每个 Edge isolate 的保护：同 IP 每 10 分钟 8 次、isolate 总计 60 次、同时 2 次。不是跨实例全局限额，isolate 重启会重置。公开 JWT 和 CORS 都不能阻止脚本滥用。
- 开放给大量用户前，应在项目网关或持久限流设施上添加跨实例请求/流量限制，并查看 Supabase 带宽预算。当前无需付费操作或新建用户资料表。

## 回滚

把 `pdf-service-config.json.enabled` 改回 false 并发布即可立即停止前端调用。
不影响已支持的本地开放副本、浏览器直连或上传 PDF。无需删除数据、关闭整个项目认证或改已有存储桶。

## 官方部署依据

- https://supabase.com/docs/guides/functions/function-configuration
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/functions/quickstart
