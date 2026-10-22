"""运动科学国际共识库：采集。
标题检索 consensus statement / position stand / position statement / expert consensus，
经运动筛选后识别发布机构、声明类型、主题。"""
import json, os, re, sys, time, urllib.parse

WORKSPACE = os.environ.get('LITDB_WORKSPACE', os.path.expanduser('~/workspace'))
BASE = os.path.join(WORKSPACE, 'consensus-db')
os.makedirs(BASE + "/data", exist_ok=True)
sys.path.insert(0, os.path.join(WORKSPACE, 'cold-lit-db'))
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location("cold_du", os.path.join(WORKSPACE, 'cold-lit-db', 'daily_update.py'))
du = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(du)

QUERIES = [
    ("consensus statement", "共识声明"),
    ("position stand", "立场声明"),
    ("position statement", "立场声明"),
    ("expert consensus", "专家共识"),
]

BODIES = [
    # (名称, 全称正则(忽略大小写), 缩写正则(大小写敏感))
    ("ACSM", re.compile(r"american college of sports medicine", re.I), re.compile(r"\bACSM\b")),
    ("IOC", re.compile(r"international olympic committee", re.I), re.compile(r"\bIOC\b")),
    ("NATA", re.compile(r"national athletic trainers.? association", re.I), re.compile(r"\bNATA\b")),
    ("WHO", re.compile(r"world health organization", re.I), re.compile(r"\bWHO\b")),
    ("AMSSM", re.compile(r"american medical society for sports medicine", re.I), re.compile(r"\bAMSSM\b")),
    ("ISSN", re.compile(r"international society of sports nutrition", re.I), re.compile(r"\bISSN\b")),
    ("NSCA", re.compile(r"national strength and conditioning association", re.I), re.compile(r"\bNSCA\b")),
    ("FIMS", re.compile(r"international federation of sports medicine", re.I), re.compile(r"\bFIMS\b")),
    ("ECSS", re.compile(r"european college of sport science", re.I), re.compile(r"\bECSS\b")),
]


def detect_body(title, abstract, institutions):
    t = (title or "") + " " + (abstract or "") + " " + " ".join(institutions or [])
    for name, full_rx, abbr_rx in BODIES:
        if full_rx.search(t) or abbr_rx.search(t):
            return name
    return "其他机构"


TOPICS = [
    ("脑震荡", re.compile(r"concussion|mild traumatic brain injury", re.I)),
    ("能量供应不足", re.compile(r"RED-?S|energy availability|female athlete triad|low energy availability", re.I)),
    ("膳食补充剂", re.compile(r"supplement|creatine|ergogenic", re.I)),
    ("热疾病", re.compile(r"heat illness|heat stroke|exertional heat", re.I)),
    ("高原训练", re.compile(r"altitude|hypox", re.I)),
    ("运动营养", re.compile(r"nutrition|dietary|protein intake", re.I)),
    ("青少年运动员", re.compile(r"youth athlet|adolescent athlet|pediatric", re.I)),
    ("女运动员", re.compile(r"female athlet|women.?s sport|pregnan", re.I)),
    ("体力活动指南", re.compile(r"physical activity guideline|exercise prescription|FITTE", re.I)),
    ("慢性病运动", re.compile(r"cancer|diabetes|cardiovascular|hypertension|obesity", re.I)),
    ("心理健康", re.compile(r"mental health|anxiety|depression|harassment|abuse", re.I)),
    ("睡眠", re.compile(r"sleep", re.I)),
    ("损伤预防", re.compile(r"injury prevention|injury risk|overuse", re.I)),
    ("反兴奋剂", re.compile(r"doping|anti-doping|WADA", re.I)),
    ("力量训练", re.compile(r"resistance training|strength training", re.I)),
    ("有氧运动", re.compile(r"aerobic exercise|cardiorespiratory", re.I)),
    ("老年运动", re.compile(r"older adult|elderly|aging", re.I)),
    ("负荷管理", re.compile(r"load management|training load|overtraining", re.I)),
]


def detect_topics(title, abstract):
    t = (title or "") + " " + (abstract or "")
    return [name for name, rx in TOPICS if rx.search(t)][:4]


def detect_type(title, fallback="共识声明"):
    """按标题实际措辞定类型，优先于检索词标签。"""
    t = title or ""
    if re.search(r"position stand", t, re.I):
        return "立场声明"
    if re.search(r"expert consensus", t, re.I):
        return "专家共识"
    if re.search(r"consensus statement", t, re.I):
        return "共识声明"
    if re.search(r"position statement", t, re.I):
        return "立场声明"
    if re.search(r"\bguideline", t, re.I):
        return "指南"
    return fallback


# ---- 数据底座清洗规则（三条件保留 + 噪声剔除）----
_SPORT_J = re.compile(r"sport|exercis|athlet|kinesiol|physical therap|strength and conditioning|paralympic|olympic|biomechani|journal of science and medicine|clinical journal of sport|pediatric exercise", re.I)
_SPORT_T = re.compile(r"\bsport|athlet|exercis|physical activ|fitness|kinesiol|paralympic|olympic|resistance training|strength training|exercise training|interval training|aerobic\b", re.I)
_JUNK_T = re.compile(r"^(letter|reply)\b|erratum|corrigendum|commentary on", re.I)


def final_keep(title, journal, body):
    """共识库最终保留判定：已知机构 / 体育期刊 / 标题运动信号，三者居其一；
    勘误/更正/读者来信直接剔除。"""
    if _JUNK_T.search(title or ""):
        return False
    if body != "其他机构":
        return True
    if _SPORT_J.search(journal or ""):
        return True
    if _SPORT_T.search(title or ""):
        return True
    return False


def save(records):
    records.sort(key=lambda x: (-(x.get("cited") or 0)))
    du.oa_runtime.atomic_json(BASE + "/data/consensus.json", records)


def main():
    raise du.oa_runtime.PipelineError('Legacy full collector disabled; use run_pipeline.py --job consensus')
    seen, records = set(), []
    # 断点续跑：已有数据先载入
    try:
        with open(BASE + "/data/consensus.json", encoding="utf-8") as f:
            records = json.load(f)
        for r in records:
            seen.add((r.get("doi") or "") or ("T:" + du.norm_title(r.get("title") or "")))
        print(f"续跑：已载入 {len(records)} 篇", flush=True)
    except FileNotFoundError:
        pass
    done_queries = set()
    try:
        with open(BASE + "/data/_progress.json", encoding="utf-8") as f:
            done_queries = set()  # legacy progress may have hit a silent page cap
    except Exception:
        pass
    for q, typ in QUERIES:
        if q in done_queries:
            print(f"  [{q}] 已完成，跳过", flush=True)
            continue
        params = {"filter": f"title.search:{q}", "select": du.SELECT, "per-page": 50}
        n_new = 0
        for data in du.oa_runtime.iter_pages(params):
            for r in data.get("results", []):
                title = (r.get("title") or "").strip()
                if not title:
                    continue
                journal = ((r.get("primary_location") or {}).get("source") or {}).get("display_name")
                abstract = du.recon_abstract(r.get("abstract_inverted_index"))
                if not du.sport_keep(r, title, abstract, journal):
                    continue
                # 标题必须含声明类关键词（防分词召回）
                if not re.search(r"consensus|position stand|position statement|guideline|recommendation", title, re.I):
                    continue
                k = du.norm_doi(r.get("doi")) or ("T:" + du.norm_title(title))
                if k in seen:
                    continue
                seen.add(k)
                insts = []
                authors = []
                for a in (r.get("authorships") or []):
                    an = ((a.get("author") or {}).get("display_name") or "").strip()
                    if an:
                        authors.append(an)
                    for ins in (a.get("institutions") or []):
                        dn = (ins.get("display_name") or "").strip()
                        if dn:
                            insts.append(dn)
                boa = r.get("best_oa_location") or {}
                rec = {
                    "id": r.get("id"), "doi": du.norm_doi(r.get("doi")),
                    "title": title, "year": r.get("publication_year"),
                    "authors": authors[:12], "journal": journal,
                    "cited": r.get("cited_by_count") or 0,
                    "body": detect_body(title, abstract, insts),
                    "type": typ,
                    "topics": detect_topics(title, abstract),
                    "abstract": abstract,
                    "pdf_url": boa.get("pdf_url"),
                }
                records.append(rec)
                n_new += 1
        print(f"  [{q}] 新增 {n_new}", flush=True)
        done_queries.add(q)
        du.oa_runtime.atomic_json(BASE + "/data/_progress.json", sorted(done_queries))
        save(records)
        print(f"  已落盘：共 {len(records)} 篇", flush=True)
    save(records)
    print(f"共识库: {len(records)} 篇")


if __name__ == "__main__":
    main()
