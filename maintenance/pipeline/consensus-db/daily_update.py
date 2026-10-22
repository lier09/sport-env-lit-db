"""共识库每日增量更新：复用 collect.py 的检索与识别逻辑，只抓新增。"""
import json, os, sys, time, urllib.parse
from datetime import date, timedelta

WORKSPACE = os.environ.get('LITDB_WORKSPACE', os.path.expanduser('~/workspace'))
BASE = os.path.join(WORKSPACE, 'consensus-db')
os.makedirs(BASE + "/data", exist_ok=True)
# cold-lit-db 的 daily_update 与本文件同名，用 importlib 换名加载避免自引用
# （原写法用 sys.path 顺序导致 import daily_update 命中本文件自身，du.norm_title 报错）
import importlib.util as _ilu
# 2026-10-20：cold_du（文献总库 daily_update）自带 `import openalex_auth`，
# 按文件加载时它的目录不在 sys.path 上，必须先加入，否则 ModuleNotFoundError。
sys.path.insert(0, os.path.join(WORKSPACE, 'cold-lit-db'))
_spec = _ilu.spec_from_file_location(
    "cold_du", os.path.join(WORKSPACE, 'cold-lit-db', 'daily_update.py'))
du = _ilu.module_from_spec(_spec)
sys.modules["cold_du"] = du
_spec.loader.exec_module(du)
sys.path.insert(0, BASE)
from collect import QUERIES, detect_body, detect_topics, detect_type, final_keep

MERGED = BASE + "/data/consensus.json"
DAILY = BASE + "/data/daily_new.json"


def load_json(p, dflt):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return dflt


def main():
    du.guard.require_managed()
    full = "--full" in sys.argv[1:]
    if full:
        print("全量重检模式：重跑全部检索组（无日期限制），去重合并捡回漏检")
    merged = load_json(MERGED, [])
    seen = set()
    for r in merged:
        seen.update(du.guard.identity(r))
    blocked = du.guard.blocked(os.path.join(du.BASE, 'data', 'dedup_blocklist_20261014.json'))
    new_recs = []
    qstat = []  # per-query 记账：与文献总库同口径，失败的查询组不再静默跳过
    try:
        for q, typ in QUERIES:
            params = {"filter": f"title.search:{q}", "select": du.SELECT, "per-page": 50}
            if not full:
                params["sort"] = "publication_date:desc"
            n_new = pages = 0
            fetch_failed = False
            for data in du.oa_runtime.iter_pages(params):
                pages += 1
                for r in data.get("results", []):
                    title = (r.get("title") or "").strip()
                    if not title:
                        continue
                    journal = ((r.get("primary_location") or {}).get("source") or {}).get("display_name")
                    abstract = du.recon_abstract(r.get("abstract_inverted_index"))
                    if du.guard.identity(r) & blocked:
                        continue
                    if not du.guard.admissible(BASE, r, abstract, query=q, kind=typ):
                        continue
                    if not du.sport_keep(r, title, abstract, journal):
                        continue
                    import re as _re
                    if not _re.search(r"consensus|position stand|position statement|guideline|recommendation", title, _re.I):
                        continue
                    keys = du.guard.identity(r)
                    if keys & seen:
                        continue
                    body = detect_body(title, abstract, [])
                    if not final_keep(title, journal, body):
                        continue
                    insts, authors = [], []
                    for a in (r.get("authorships") or []):
                        an = ((a.get("author") or {}).get("display_name") or "").strip()
                        if an:
                            authors.append(an)
                        for ins in (a.get("institutions") or []):
                            dn = (ins.get("display_name") or "").strip()
                            if dn:
                                insts.append(dn)
                    # 有机构信息时修正 body
                    body = detect_body(title, abstract, insts)
                    if not final_keep(title, journal, body):
                        continue
                    seen.update(keys)
                    boa = r.get("best_oa_location") or {}
                    new_recs.append({
                        "id": r.get("id"), "doi": du.norm_doi(r.get("doi")),
                        "title": title, "year": r.get("publication_year"),
                        "authors": authors[:12], "journal": journal,
                        "cited": r.get("cited_by_count") or 0,
                        "body": body,
                        "type": detect_type(title, typ), "topics": detect_topics(title, abstract),
                        "abstract": abstract, "pdf_url": boa.get("pdf_url"),
                        "date": date.today().isoformat(),
                    })
                    n_new += 1
            print(f"  [{q}] 新增 {n_new}", flush=True)
            qstat.append({"q": q, "type": typ, "pages": pages, "new_kept": n_new,
                          "incomplete": fetch_failed})
    except du.oa_runtime.PipelineError:
        completed = {x["q"] for x in qstat}
        qstat.extend(dict(x, incomplete=True, status="pending_or_not_started")
                     for x in [{"q": q, "type": typ} for q, typ in QUERIES] if x["q"] not in completed)
        du.oa_runtime.atomic_json(BASE + f"/logs/qstat-{date.today().isoformat()}.json", qstat)
        raise
    # 保存 per-query 记账；有失败组时在日志里明确告警，避免"静默零新增"
    os.makedirs(BASE + "/logs", exist_ok=True)
    qf = BASE + f"/logs/qstat-{date.today().isoformat()}.json"
    du.oa_runtime.atomic_json(qf, qstat)
    n_inc = sum(1 for s in qstat if s["incomplete"])
    if n_inc:
        print(f"⚠ 本轮 {n_inc}/{len(qstat)} 个查询组请求失败，结果不完整，见 {qf}", flush=True)
    if new_recs:
        merged = new_recs + merged
        du.oa_runtime.atomic_json(MERGED, merged)
        daily = load_json(DAILY, [])
        cutoff = (date.today() - timedelta(days=7)).isoformat()
        daily = [d for d in daily if d.get("date", "") >= cutoff] + new_recs
        du.oa_runtime.atomic_json(DAILY, daily)
        print(f"共识库新增 {len(new_recs)} 篇，当前 {len(merged)} 篇")
        print('数据已更新；不改网页代码、不自动发布。')
        return True
    print("共识库今日无新增")
    return False


if __name__ == "__main__":
    sys.exit(0 if main() else 0)
