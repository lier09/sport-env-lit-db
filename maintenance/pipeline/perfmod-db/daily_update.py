"""建模库数据底座每日重检：全量重跑全部检索组，去重合并捡回漏检。"""
import json, os, sys, time, urllib.parse
from datetime import date, timedelta

WORKSPACE = os.environ.get('LITDB_WORKSPACE', os.path.expanduser('~/workspace'))
BASE = os.path.join(WORKSPACE, 'perfmod-db')
os.makedirs(BASE + "/data", exist_ok=True)
# cold-lit-db 的 daily_update 与本文件同名，用 importlib 换名加载避免自引用
import importlib.util as _ilu
# 2026-10-20：cold_du（文献总库 daily_update）自带 `import openalex_auth`，
# 按文件加载时它的目录不在 sys.path 上，必须先加入，否则 ModuleNotFoundError。
# （consensus-db/daily_update.py 今日已做相同修复）
sys.path.insert(0, os.path.join(WORKSPACE, 'cold-lit-db'))
_spec = _ilu.spec_from_file_location(
    "cold_du", os.path.join(WORKSPACE, 'cold-lit-db', 'daily_update.py'))
du = _ilu.module_from_spec(_spec)
sys.modules["cold_du"] = du
_spec.loader.exec_module(du)
sys.path.insert(0, BASE)

MERGED = BASE + "/data/perfmod.json"
DAILY = BASE + "/data/daily_new.json"


def load_json(p, dflt):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return dflt


def main():
    du.guard.require_managed()
    import collect as C
    queries = json.load(open(BASE + "/data/queries.json", encoding="utf-8"))
    merged = load_json(MERGED, [])
    seen = set()
    for r in merged:
        seen.update(du.guard.identity(r))
    blocked = du.guard.blocked(os.path.join(du.BASE, 'data', 'dedup_blocklist_20261014.json'))
    new_recs = []
    qstat = []  # per-query 记账：与文献总库同口径，失败的查询组不再静默跳过
    try:
        for qq in queries:
            n_new = 0
            recs, qinfo = C.fetch_query(qq["q"])
            for r in recs:
                if du.guard.identity(r) & blocked:
                    continue
                if not du.guard.admissible(BASE, r, du.recon_abstract(r.get('abstract_inverted_index')),
                                           query=qq['q'], tag=qq['tag']):
                    continue
                rec = C.record_from(r, qq["tag"])
                if not rec:
                    continue
                if not C.final_ok(rec):
                    continue
                keys = du.guard.identity(rec)
                if keys & seen:
                    continue
                seen.update(keys)
                rec["date"] = date.today().isoformat()
                new_recs.append(rec)
                n_new += 1
            qinfo["new_kept"] = n_new
            qstat.append(qinfo)
            print(f"  [{qq['q']}] 新增 {n_new}", flush=True)
    except du.oa_runtime.PipelineError:
        completed = {x["q"] for x in qstat}
        qstat.extend(dict(x, incomplete=True, status="pending_or_not_started")
                     for x in [{"q": qq["q"], "tag": qq["tag"]} for qq in queries] if x["q"] not in completed)
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
        C.save(merged)
        daily = load_json(DAILY, [])
        cutoff = (date.today() - timedelta(days=7)).isoformat()
        daily = [d for d in daily if d.get("date", "") >= cutoff] + new_recs
        du.oa_runtime.atomic_json(DAILY, daily)
        print(f"建模库新增 {len(new_recs)} 篇，当前 {len(merged)} 篇")
        print('数据已更新；不改网页代码、不自动发布。')
        return True
    print("建模库今日无新增")
    return False


if __name__ == "__main__":
    sys.exit(0 if main() else 0)
