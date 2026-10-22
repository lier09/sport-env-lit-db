#!/usr/bin/env python3
"""每日增量更新：抓取各检索词的新文献 → 清洗过滤 → 去重入库 → 重算画像 → 重建网站。

用法：python3 daily_update.py [--from YYYY-MM-DD] [--to YYYY-MM-DD]
默认增量窗口：上次运行日期 - 7 天 至 今天（7 天重叠防止收录延迟）。
"""
import json, os, re, sys, time, datetime, urllib.parse, urllib.request, subprocess
import openalex_runtime as oa_runtime
import openalex_auth  # 免费 API key 注入（无 key 文件时行为不变）
import ingest_guard as guard

BASE = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE)

SELECT = ("id,doi,title,publication_year,authorships,primary_location,"
          "cited_by_count,type,open_access,abstract_inverted_index,topics,"
          "best_oa_location,is_retracted")
PER_PAGE = 50
MAX_PER_QUERY = 1000
SLEEP = 5.0  # 2026-10-12: 2s 仍触发 429 限流，提至 5s 降速慢跑

SPORT_J = re.compile(r'\bsports?\b|\bexercise\w*\b|\bkinesiolog\w*|\bphysical therap\w*|\bphysiotherap\w*|\brehabilitation\b|\borthop(a)?edic\w*|\bstrength\b|\bconditioning\b|\bathletic train\w*|\bhuman performance\b|\bapplied physiolog\w*|\bthermal biolog\w*|\bphysical education\b', re.I)
SPORT_T = re.compile(r'\bsports?\b|\bexercise\w*\b|\bkinesiolog\w*|\brehabilitation\b|\bphysical therapy\b|\borthopedics\b', re.I)
SPORT_KW_TITLE = re.compile(r'\bathletes?\b|\bsports?\b|\bsporting\b|\bexercis\w+\b|\btraining\b|\bovertraining\b|\bplayers?\b|\bperformance\b|\brecover\w+\b', re.I)
# 运动同义表述（2026-10-11 规则审计 R1：缺摘要论文标题常含这些但不在旧词表）
SPORT_SYN = re.compile(r'\baerobic endurance\b|\bexercise tolerance\b|\bphysical work(?:ing)? capacity\b|\bmaximal aerobic (?:capacity|performance|power)\b|\bmaximum aerobic (?:capacity|performance)\b|\btime to exhaustion\b|\bvo2\s?max\b|\bvo2peak\b|\brunning economy\b|\bphysical fitness\b|\bcycling\b|\brunning\b|\bswimming\b|\browing\b', re.I)
MECH_J = re.compile(r'\bsports?\b|\bexercise\w*\b|\bkinesiolog\w*|\bphysical therap\w*|\bphysiotherap\w*|\brehabilitation\b|\borthop(a)?edic\w*|\bstrength\b|\bconditioning\b|\bathletic train\w*|\bhuman performance\b|\bapplied physiolog\w*|\bthermal biolog\w*|\bphysical education\b|\bphysiolog\w*|\bbiochem\w*|\bcell biology\b|\bmolecular\b|\bendocrinol\w*|\bneurosc\w*', re.I)
MECH_T = re.compile(r'\bsports?\b|\bexercise\w*\b|\bkinesiolog\w*|\brehabilitation\b|\bphysical therapy\b|\borthopedics\b|\bphysiology\b|\bbiochemistry\b|\bcell biology\b|\bendocrinology\b', re.I)
# 全局离题排除（标题/摘要出现即剔除，适用于所有模式）
# 2026-10-10: 取消全局一票否决。拆分为硬否决（无歧义离题）+ 软否决（需结合内容判断）。
# 硬否决：模式生物/病原体/农药/生殖，无歧义
JUNK_HARD = re.compile(
    r'drosophila|zebrafish|danio rerio|\btoad\b|\bfrog\b|bufo\b|goldfish|\btrout\b|'
    r'minnow\b|flounder|trypanosoma|histoplasma|'
    r'pesticide|herbicide|in-vitro fertilization|\bIVF\b|'
    r'cross-cultural adaptation', re.I)
# 软否决：仅当无强运动信号时才否决（避免摘要提及某词就误删相关论文）
# 已撤：lactat（乳酸是核心运动生理概念）、machine learning、deep learning、neural network
JUNK_SOFT = re.compile(
    r'forage|ovine|bovine|porcine|'
    r'swine|poultry|broiler|laying hen|wheat|\bcrop\b|dairy|reformator|outage|'
    r'hvac|chemotherapy|carcinoma|\btumor\b|concrete\b|asphalt|maize|\brice\b|'
    r'supplementary|training manual|\bhandbook\b|'
    r'strawberr|\bblueberr\w*|\bapple\b|\borange\b|\btomato\b|\bpotato\b|postharvest|'
    r'post-harvest|shelf.?life|\bfruit\b|vegetable\b|seafood|shrimp|honeybee', re.I)
# 强运动信号：标题出现即视为相关，软否决不生效
STRONG_SPORT = re.compile(r'athlet|\bsports?\b|exercis\w+|player\b|training\b', re.I)
# 2026-10-11: 人群/动物分类
POP_HUMAN = re.compile(r'\bhumans?\b|athletes?|subjects|participants|volunteers|patients|\bmen\b|\bwomen\b|children|adults', re.I)
POP_ANIMAL = re.compile(r'\brats?\b|\bmice\b|murine|rodents?|canine|porcine|ovine|rabbits?|\bdogs?\b|cattle\b|pigs?\b', re.I)
def classify_population(title, abstract):
    t = (title or '') + ' ' + (abstract or '')
    h, a = bool(POP_HUMAN.search(t)), bool(POP_ANIMAL.search(t))
    if h and a: return 'both'
    if h: return 'human'
    if a: return 'animal'
    return 'unknown'
# 2026-10-10: 疾病论文需有运动关联。硬疾病词+无运动信号则否决
JUNK_DISEASE = re.compile(
    r'\bcows?\b|cattle\b|ovine\b|porcine\b|alzheimer|parkinson\b|amyloid|'
    r'dementia\b|glioblastoma|melanoma\b', re.I)
EXERCISE_SIG = re.compile(r'athlet|exercis|\bsport\b|player|training|exertional|physical activity|aerobic endurance|exercise tolerance|physical work capacity|vo2\s?max|time to exhaustion', re.I)
# 肿瘤冷冻消融（cryoablation）非运动冷疗
JUNK_CRYOABL = re.compile(r'cryoablation|image-guided cryo', re.I)
# 保留旧名兼容（不再作为全局否决使用）
JUNK_ANY = JUNK_HARD
MECH_J = re.compile(r'sport|exercise|kinesiolog|physical therap|physiotherap|rehabilitation|orthop(a)?edic|strength|conditioning|athletic train|human performance|applied physiolog|thermal biolog|physical education|physiolog|biochem|cell biology|molecular|endocrinol|neurosci', re.I)
MECH_T = re.compile(r'sport|exercise|kinesiolog|rehabilitation|physical therapy|orthopedics|physiology|biochemistry|cell biology|endocrinology', re.I)
MECH_ANCHOR = re.compile(r'exercis|sport|athlet|muscle|skeletal|train|perform|acclim|thermoregul|hypox|hyperox|altitude|oxygen|respirat|mitochondri|aerobic|endurance|fitness|vo2', re.I)
PLANT = re.compile(r'plant|agricultur|crop', re.I)
# 2026-10-10: PLANT 只查具体 topic/子领域，不查大领域名。
# 之前 topics_text 把 "Agricultural and Biological Sciences"（生物学大领域）也拼进去，
# 导致人类运动论文被 OpenAlex 误标 livestock topic 时连带误杀。
# 例：Thermoregulatory and cognitive responses…（J Therm Biol 2026）被误杀。
def plant_topic(topics):
    for t in (topics or []):
        name = (t.get("display_name") or "") + " " + ((t.get("subfield") or {}).get("display_name") or "")
        if re.search(r'plant|agronom|horticultur|\bcrop\b', name, re.I):
            return True
    return False
CLIN = re.compile(r'diabetic|\bulcers?\b|\bwounds?\b|wound healing|\bburns?\b|graft|necrosis|\bstroke\b|amputation|sepsis', re.I)
STRONG_TITLE = re.compile(r'athlet|\bsports?\b|player|soccer|exercis\w*', re.I)
JUNK = re.compile(r'incontinence|pregnan|obstetric|prostate cancer|breast cancer|\btumor\b|carcinoma|chemotherapy|leiomyoma|kidney develop|CAR-T|lymphoma', re.I)
ANCHOR_KEEP = re.compile(r'exercis|sport|athlet|muscle|skeletal', re.I)

def fetch(url, retries=3):
    return oa_runtime.fetch(url, retries)

def norm_doi(d):
    d = (d or "").strip().lower()
    d = re.sub(r"^https?://(dx\.)?doi\.org/", "", d)
    d = re.sub(r"^doi:\s*", "", d)
    return d or None

def norm_title(t):
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", (t or "").lower())

def recon_abstract(inv):
    if not inv:
        return None
    try:
        n = max(i for pos in inv.values() for i in pos) + 1
        words = [""] * n
        for w, pos in inv.items():
            for i in pos:
                words[i] = w
        return clean_abstract(" ".join(w for w in words if w))
    except Exception:
        return None

_ABS_HDR = "Introduction|Background|Purpose|Objective|Aim|Methods?|Results|Discussion|Conclusion|Keywords"
def clean_abstract(a):
    """修复结构化摘要的章节标题粘连，如 IntroductionExposure / flight.MethodsUsing"""
    if not a:
        return a
    a = re.sub(r"([a-z0-9])\.(" + _ABS_HDR + r")", r"\1. \2", a)
    a = re.sub(r"(" + _ABS_HDR + r")([A-Z][a-z])", r"\1 \2", a)
    return a

def topics_text(topics):
    out = []
    for t in (topics or []):
        out.append((t.get("display_name") or ""))
        sf = (t.get("subfield") or {})
        f = (t.get("field") or {})
        out.append(sf.get("display_name") or "")
        out.append(f.get("display_name") or "")
    return " ".join(out)

def map_type(r):
    title = (r.get("title") or "").lower()
    if "meta-analysis" in title or "meta analysis" in title:
        return "Meta分析"
    kind = r.get("type") or ""
    return {"review": "综述", "article": "原创研究", "journal-article": "原创研究",
            "dissertation": "学位论文", "dataset": "数据集", "software": "软件",
            "preprint": "预印本", "book": "专著", "book-chapter": "书籍章节",
            "report": "报告", "editorial": "社论", "erratum": "勘误",
            "letter": "通信", "proceedings-article": "会议论文"}.get(kind, kind or "类型未标注")


# 待核查论文（缺摘要/空topics，不自动纳入，需人工审核）
PENDING_REVIEW = []

def effective_queries(queries):
    """Use one reproducible query plan for daily and historical discovery."""
    terms = '"aerobic endurance" OR "exercise tolerance" OR "physical work capacity" OR "physical working capacity" OR "time to exhaustion" OR "VO2max" OR "VO2peak" OR "running economy" OR "physical fitness"'
    environments = {
        '低温': '"cold exposure" OR "cold water immersion" OR hypothermia OR "cryotherapy"',
        '高温': '"heat exposure" OR "heat stress" OR hyperthermia OR "heat acclimation"',
        '高温高湿': '("heat" AND "humidity") OR "hot humid" OR "heat stress"',
        '高原低氧': 'hypoxia OR "altitude" OR "hypobaric" OR "low oxygen"',
        '高氧': 'hyperoxia OR "hyperbaric oxygen" OR "oxygen supplementation"',
        '交叉适应': '"cross adaptation" OR "cross-acclimation" OR "cross tolerance"',
        '其他环境': '"circadian" OR "sleep deprivation" OR "jet lag"',
    }
    return list(queries) + [{'env': env, 'mode': 'sport', 'q': f'({q}) AND ({terms})', 'tag': '同义补充'}
                            for env, q in environments.items()]

def sport_keep(r, title, abstract, journal):
    tt = topics_text(r.get("topics"))
    if SPORT_J.search(journal or ""):
        return True
    if SPORT_T.search(tt):
        return True
    # 规则 c：关键词必须出现在标题（词边界，避免 Transportation/Trainingskonzept 类误伤）
    # 且 topics 不能是植物/农业方向
    # 2026-10-11 R1: 同义表述视同关键词
    # 2026-10-11 用户要求：缺摘要或 topics 为空只触发待核查，不自动纳入
    if (SPORT_KW_TITLE.search(title) or SPORT_SYN.search(title)) and not plant_topic(r.get("topics")):
        if abstract or tt.strip():
            # 有信息时维持原有的 life/med 语境门槛
            if re.search(r"health|life|medicine|biolog", tt, re.I):
                return True
        else:
            # 缺摘要且无主题：记入待核查，不自动纳入
            PENDING_REVIEW.append({
                "id": r.get("id"), "doi": r.get("doi"), "title": title,
                "reason": "missing_abstract_and_topics", "env": r.get("env_hint", "")
            })
            return False
    return False

def mechanism_keep(r, title, abstract, journal):
    if not MECH_ANCHOR.search(title + " " + (abstract or "")):
        return False
    tt = topics_text(r.get("topics"))
    if plant_topic(r.get("topics")):
        return False
    if MECH_J.search(journal or ""):
        return True
    if MECH_T.search(tt):
        return True
    if re.search(r"health|life|medicine|biolog", tt, re.I):
        return True
    return False

def hyperbaric_keep(r, title, abstract, journal):
    if re.search(r"chatbot", title, re.I):
        return False
    # Explicit oxygen exposure + exercise outcome in title remains eligible without an abstract.
    # PMID 40676637 / OpenAlex W4412492721 exposes the previous missing-abstract false negative.
    # 2026-10-11 R4: 结局词表扩展
    if re.search(r'\bhyperbaric oxygen\b|\bhyperoxi\w*\b', title, re.I) and re.search(
            r'\baerobic endurance\b|\bexercise tolerance\b|\b(?:maximal|maximum) aerobic (?:performance|capacity|power)\b|\bphysical work(?:ing)? capacity\b|'
            r'\btime to exhaustion\b|\bvo2\s?max\b|\b(?:cycling|running|swimming|rowing) (?:time[-\s]?trial|performance)\b|'
            r'\brecovery\b|\bmuscle fatigue\b|\bphysical fitness\b', title, re.I):
        return True
    t = title + " " + (abstract or "")
    if SPORT_J.search(journal or ""):
        return True
    if STRONG_TITLE.search(title):
        return True
    # 2026-10-11 R4: 运动词表增加动名词
    if re.search(r'athlet|\bsports?\b|soccer|football|rugby|basketball|runner|triathlet|swimmer|cyclist|\bplayer\b|exercis\w*|training|cycling|running|swimming|rowing|walking|skiing', t, re.I) \
            and re.search(r'perform|recover|injur|muscle|rehab|fatigue|soreness', t, re.I) \
            and not CLIN.search(t):
        return True
    return False

def clean_record(r, env, tag, mode, qq_q="", dis_mode=False):
    title = (r.get("title") or "").strip()
    if not title:
        return None
    journal = ((r.get("primary_location") or {}).get("source") or {}).get("display_name")
    abstract = recon_abstract(r.get("abstract_inverted_index"))
    if not guard.admissible(BASE, r, abstract, env=env, tag=tag, mode=mode, query=qq_q):
        return None
    if mode == "mechanism":
        keep = mechanism_keep(r, title, abstract, journal)
    elif mode == "hyperbaric":
        keep = hyperbaric_keep(r, title, abstract, journal)
    else:
        keep = sport_keep(r, title, abstract, journal)
    if not keep:
        return None
    if mode in ('sport', 'hyperbaric') and not SPORT_J.search(journal or '') \
            and not EXERCISE_SIG.search(title + ' ' + (abstract or '')) \
            and not SPORT_SYN.search(title + ' ' + (abstract or '')):
        # performance/recovery and broad medical topics are ambiguous. Never
        # silently treat building performance or wound recovery as sport.
        guard.review(BASE, r, 'exercise_relationship_requires_review',
                     env=env, tag=tag, mode=mode, query=qq_q)
        return None
    # Existing broad physiology/oxygen anchors alone cannot establish an
    # exercise relationship. Retain borderline mechanisms for human review.
    if mode == 'mechanism' and not re.search(
            r'exercis|athlet|\bsports?\b|physical activity|aerobic endurance|exercise tolerance|'
            r'physical work(?:ing)? capacity|vo2\s?max|running|cycling|swimming|resistance training',
            title + ' ' + (abstract or ''), re.I):
        guard.review(BASE, r, 'mechanism_exercise_relationship_requires_review',
                     env=env, tag=tag, mode=mode, query=qq_q)
        return None
    # 2026-10-10: 查询词已加引号做精确短语检索，此处去引号以便匹配规则 key
    qq_q = qq_q.strip('"')
    # 高氧低氧悖论相关查询：OpenAlex 分词召回较松，需二次收紧
    _hhp_t = title + " " + (abstract or "")
    if qq_q in ("hyperoxic-hypoxic paradox", "hyperoxic hypoxic paradox"):
        if not re.search(r"paradox", _hhp_t, re.I):
            return None
    elif qq_q == "normobaric oxygen paradox":
        if not re.search(r"paradox|erythropoie|\bEPO\b", _hhp_t, re.I):
            return None
    elif qq_q == "intermittent hyperoxia":
        if not re.search(r"paradox|HIF|hypoxia-inducible|erythropoie|\bEPO\b",
                          _hhp_t, re.I):
            return None
    # 定向交叉适应查询：必须同时涉及低氧/高原，避免召回纯热习服文献
    if qq_q in ("heat acclimation hypoxia", "cold acclimation hypoxia"):
        if not re.search(r"hypox|altitude", _hhp_t, re.I):
            return None
    # 高氧恢复：必须有运动语境，避免肺损伤临床文献
    elif qq_q == "hyperoxic recovery":
        # 2026-10-11 R8: 补同义表述
        if not re.search(r"exercis|sport|athlet|perform|sprint|training|player|"
                          r"aerobic endurance|exercise tolerance|vo2", _hhp_t, re.I):
            return None
    # 以下为搜索词审计新增查询的收紧规则（OpenAlex 分词召回过松）
    _gap_rules = {
        "winter swimming": r"winter[\s-]*swim",
        "dry immersion": r"dry[\s-]*immersion",
        "sleep extension": r"sleep[\s-]*extension",
        "breath-hold diving": r"breath[\s-]*hold",
        "uncompensable heat stress": r"uncompensable",
        "repeated sprint training in hypoxia": r"repeated[\s-]*sprint",
        "percooling": r"percool",
        # 交叉适应类查询：OpenAlex 模糊召回严重（如 cross-over 试验设计混入 cross-tolerance），必须验证原短语
        "cross-adaptation": r"cross[\s-]?adaptation",
        "cross adaptation": r"cross[\s-]?adaptation",
        "cross-tolerance": r"cross[\s-]?tolerance",
        "cross tolerance": r"cross[\s-]?tolerance",
        "cross-acclimation": r"cross[\s-]?acclimation",
        "cross acclimation": r"cross[\s-]?acclimation",
        "cross-stressor adaptation": r"cross[\s-]?stressor",
        "stress cross-protection": r"cross[\s-]?protection",
    }
    if qq_q in _gap_rules:
        if not re.search(_gap_rules[qq_q], _hhp_t, re.I):
            return None
    elif qq_q == "exertional heat illness":
        if not (re.search(r"exertional", _hhp_t, re.I)
                and re.search(r"\bheat\b", _hhp_t, re.I)):
            return None
    # 机制类离题二次排除
    if mode == "mechanism":
        t = title + " " + (abstract or "")
        if JUNK.search(t) and not ANCHOR_KEEP.search(t):
            return None
    # 全局离题排除：硬否决无歧义；软否决仅在无强运动信号时生效
    _t = title + " " + (abstract or "")
    if JUNK_HARD.search(_t):
        return None
    if JUNK_SOFT.search(_t) and not STRONG_SPORT.search(title):
        return None
    # 疾病论文：结合环境与运动的实际研究关系判断（2026-10-11 用户要求）
    # 有运动信号的不直接排除，转待核查；无运动信号的才排除
    if JUNK_DISEASE.search(_t):
        if EXERCISE_SIG.search(_t) or SPORT_SYN.search(title):
            guard.review(BASE, r, 'disease_with_exercise_signal', env=env, tag=tag, mode=mode, query=qq_q)
            return None  # 待核查，不自动纳入
        return None
    # 肿瘤冷冻消融非运动冷疗
    if JUNK_CRYOABL.search(_t):
        return None
    # 临床 stroke（非热射病）无运动信号则否决
    if re.search(r'\bstroke\b', title, re.I) and 'heat stroke' not in title.lower() \
            and not EXERCISE_SIG.search(_t):
        return None
    # cross-* 查询排除跨文化适应（量表翻译类）
    if "cross" in qq_q and "cross-cultural" in title.lower():
        return None
    authors = []
    for a in (r.get("authorships") or []):
        n = ((a.get("author") or {}).get("display_name") or "").strip()
        if n:
            authors.append(n)
    boa = r.get("best_oa_location") or {}
    tags = [tag]
    if mode == "mechanism":
        tags = ["机制研究", tag]
    rec = {
        "id": r.get("id"), "doi": norm_doi(r.get("doi")),
        "title": title, "year": r.get("publication_year"),
        "authors": authors, "journal": journal,
        "cited": r.get("cited_by_count") or 0,
        "cited_prev": r.get("cited_by_count") or 0,
        "type": ("学位论文" if dis_mode else map_type(r)),
        "oa": bool((r.get("open_access") or {}).get("is_oa")),
        "abstract": abstract, "tags": tags, "env": [env],
        "pdf_url": boa.get("pdf_url"),
        "population": classify_population(title, abstract),
        "_authorships": r.get("authorships") or [],
    }
    if r.get("is_retracted"):
        rec["retracted"] = True
    return rec

def refresh_cited(merged):
    """刷新一部分论文的被引数（支撑“被引飙升”）：返回 (刷新数, 飙升数)。
    池子：2020 年后被引>=5 的 + 总被引 Top 200；每天轮换一部分。"""
    pool = [p for p in merged
            if (p.get("year") or 0) >= 2020 and (p.get("cited") or 0) >= 5]
    top200 = sorted(merged, key=lambda x: -(x.get("cited") or 0))[:200]
    ids = set()
    for p in pool + top200:
        wid = (p.get("id") or "").split("/")[-1]
        if wid.startswith("W"):
            ids.add(wid)
    ids = sorted(ids)
    if not ids:
        return 0, 0
    # 按日期轮换，保证覆盖
    doy = datetime.date.today().timetuple().tm_yday
    chunk, per = 2000, 100
    start = (doy * 1500) % max(1, len(ids))
    sel = [ids[(start + i) % len(ids)] for i in range(min(chunk, len(ids)))]
    by_wid = {}
    for p in merged:
        wid = (p.get("id") or "").split("/")[-1]
        if wid in ids:
            by_wid[wid] = p
    n_ref, n_surge = 0, 0
    for i in range(0, len(sel), per):
        batch = sel[i:i + per]
        f = "openalex:" + "|".join(batch)
        params = {"filter": f, "select": "id,cited_by_count", "per-page": per}
        url = "https://api.openalex.org/works?" + urllib.parse.urlencode(params)
        data = fetch(url)
        if not data:
            continue
        for r in data.get("results", []):
            wid = (r.get("id") or "").split("/")[-1]
            p = by_wid.get(wid)
            if not p:
                continue
            new_c = r.get("cited_by_count") or 0
            old_c = p.get("cited") or 0
            if p.get("cited_prev") is None:
                p["cited_prev"] = old_c
            if new_c != old_c:
                p["cited_prev"] = old_c
                p["cited"] = new_c
                n_ref += 1
                if new_c - old_c >= 8:
                    n_surge += 1
            time.sleep(0.15)
    print(f"被引刷新: {n_ref} 篇变化, {n_surge} 篇飙升(≥8)")
    return n_ref, n_surge

# v66 起：前端从私有存储桶拉取 4 分片（papers-1~4.json）并行加载；
# 完整 papers.json 已涨至 ~148MB，超过 Supabase 单对象上限（413 EntityTooLarge），
# 故每次重建后必须切分分片再逐片上传。
def split_shards(dpapers, n=4):
    import json as _json
    papers = _json.load(open(dpapers, encoding="utf-8"))
    # 仅移除前端不用的 _authorships；摘要必须完整保存。
    # 显示预览长度由前端控制，不能在生成数据分片时截断摘要。
    lite = []
    for x in papers:
        r = {k: v for k, v in x.items() if k != "_authorships"}
        # Preserve compact institutions before dropping raw authorship metadata.
        names = []
        for item in x.get("affiliations") or []:
            name = item if isinstance(item, str) else item.get("display_name") or item.get("name")
            if name and name not in names:
                names.append(name)
        for author in x.get("_authorships") or []:
            for institution in author.get("institutions") or []:
                name = institution.get("display_name")
                if name and name not in names:
                    names.append(name)
        r["affiliations"] = names
        lite.append(r)
    papers = lite
    sizes = [len(_json.dumps(p, ensure_ascii=False).encode("utf-8")) for p in papers]
    total = sum(sizes)
    bounds, start, acc = [], 0, 0
    for i in range(1, n):
        target = total * i / n
        while start < len(papers) and acc + sizes[start] <= target:
            acc += sizes[start]; start += 1
        bounds.append(start)
    bounds = [0] + bounds + [len(papers)]
    for i in range(n):
        chunk = papers[bounds[i]:bounds[i + 1]]
        fp = os.path.join(os.path.dirname(dpapers), f"papers-{i + 1}.json")
        _json.dump(chunk, open(fp, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"分片已生成: {n} 片，每片 ~{total / n / 1e6:.1f} MB，共 {len(papers)} 篇")
    return [os.path.join(os.path.dirname(dpapers), f"papers-{i + 1}.json")
            for i in range(n)]



def build_shard_manifest(shards):
    """Upload immutable version paths first, then switch one manifest pointer."""
    import hashlib
    entries = []
    ids = set()
    for i, path in enumerate(shards, 1):
        raw = open(path, "rb").read()
        if len(raw) > 50 * 1024 * 1024:
            raise ValueError("Shard exceeds 50MB; adjust the data layout before upload")
        records = json.loads(raw)
        for record in records:
            if not record.get("id") or record["id"] in ids:
                raise ValueError("Missing or duplicate paper ID; upload cancelled")
            ids.add(record["id"])
        entries.append({"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "records": len(records)})
    version = hashlib.sha256("".join(e["sha256"] for e in entries).encode()).hexdigest()[:20]
    for i, entry in enumerate(entries, 1):
        entry["path"] = f"versions/{version}/papers-{i}.json"
    manifest = {"format": "sport-env-litdb-shards", "version": version,
                "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "total": len(ids), "shards": entries}
    fp = os.path.join(os.path.dirname(shards[0]), "manifest.json")
    with open(fp, "w", encoding="utf-8") as stream:
        json.dump(manifest, stream, ensure_ascii=False)
    return manifest, fp


def _cloud_sync_shards():
    """同步文献数据到 Supabase 私有存储（前端登录后从云端拉取分片）"""
    up = os.path.join(os.path.expanduser("~"), "workspace", "skills",
                      "supabase-litdb", "bin", "sb_storage.py")
    dp = os.path.join(BASE, "dist", "papers.json")
    if not (os.path.exists(up) and os.path.exists(dp)):
        print("跳过云端同步（上传脚本或数据文件不存在）")
        return
    print("切分 papers.json 为 4 分片…")
    shards = split_shards(dp, 4)
    manifest, manifest_path = build_shard_manifest(shards)
    ok = 0
    for i, fp in enumerate(shards, 1):
        print(f"上传 papers-{i}.json 到 Supabase Storage…")
        try:
            subprocess.run([sys.executable, up, "upload", "litdb-data",
                            manifest["shards"][i - 1]["path"], fp], check=True)
            ok += 1
        except Exception as e:
            print(f"分片 papers-{i}.json 上传失败: {e}")
    if ok < 4:
        raise RuntimeError(f"云端同步仅 {ok}/4 分片成功")
    # Only commit the active-version pointer after all immutable objects exist.
    subprocess.run([sys.executable, up, "upload", "litdb-data", "manifest.json", manifest_path], check=True)
    print("云端同步完成：4/4 分片已上传，版本清单已切换")

def main():
    guard.require_managed()
    args = sys.argv[1:]
    state_p = os.path.join(BASE, "data", "update_state.json")
    try:
        state = json.load(open(state_p, encoding="utf-8"))
    except FileNotFoundError:
        state = {}
    today = datetime.date.today().isoformat()
    full = "--full" in args
    dis = "--dissertation" in args  # 学位论文专检：type:dissertation，类型标"学位论文"
    date_from = state.get("last_run")
    if "--from" in args:
        date_from = args[args.index("--from") + 1]
    if not date_from:
        date_from = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    # 7 天重叠窗口（--full 全量重检时不限制日期）
    d0 = (datetime.date.fromisoformat(date_from) - datetime.timedelta(days=7)).isoformat()
    d1 = today
    if "--to" in args:
        d1 = args[args.index("--to") + 1]
    if full:
        print("全量重检模式：重跑全部检索组（无日期限制），去重合并捡回漏检")
    else:
        print(f"增量窗口: {d0} ~ {d1}")

    with open(os.path.join(BASE, 'data', 'queries.json'), encoding='utf-8') as stream:
        queries = effective_queries(json.load(stream))
    print(f'检索组数: {len(queries)}（含 7 组同义补充）')

    merged_p = os.path.join(BASE, "data", "merged.json")
    with open(merged_p, encoding='utf-8') as stream:
        merged = json.load(stream)
    seen = set()
    records_by_identity = {}
    for x in merged:
        for key in guard.identity(x):
            seen.add(key)
            records_by_identity[key] = x

    # 2026-10-14 去重 blocklist：已人工确认删除的重复记录，合并时跳过不再入库
    _bl_path = os.path.join(BASE, "data", "dedup_blocklist_20261014.json")
    DEDUP_BLOCKED = guard.blocked(_bl_path)

    new_records = []
    batch_seen = set()
    qstat = []  # per-query 记账
    # 用于跨环境命中的 env/tags 合并：key -> (env, tag)
    pending_merge = {}
    if dis:
        print("学位论文专检模式：各检索组限定 type:dissertation，类型标'学位论文'")
    # Each validated page is durable before cleaning; a failed query raises
    # before merged data, successful dates, builds or publication are changed.
    os.makedirs(os.path.join(BASE, "logs"), exist_ok=True)
    for qi, qq in enumerate(queries):
        f = f"title_and_abstract.search:{qq['q']}"
        if not full:
            f = f"from_publication_date:{d0},to_publication_date:{d1}," + f
        if dis:
            f = "type:dissertation," + f
        params = {"filter": f, "select": SELECT, "per-page": PER_PAGE}
        n_got = n_downloaded = 0
        total_hits = None
        try:
            for data in oa_runtime.iter_pages(params):
                total_hits = data["meta"]["count"]
                results = data["results"]
                n_downloaded += len(results)
                for r in results:
                    if guard.identity(r) & DEDUP_BLOCKED:
                        continue
                    rec = clean_record(r, qq["env"], qq["tag"], qq["mode"], qq["q"],
                                       dis_mode=dis)
                    if not rec:
                        continue
                    # 2026-10-14 去重 blocklist
                    keys = guard.identity(rec)
                    if keys & DEDUP_BLOCKED:
                        continue
                    matches = {id(records_by_identity[k]): records_by_identity[k]
                               for k in keys if k in records_by_identity}
                    if len(matches) > 1:
                        guard.review(BASE, r, 'identity_conflict_requires_review', query=qq['q'], env=qq['env'])
                        continue
                    if matches:
                        # 已存在：记录跨环境命中的 env/tag，稍后合并
                        existing = next(iter(matches.values()))
                        k = id(existing)
                        pm = pending_merge.setdefault(k, {"record": existing, "env": set(), "tags": set()})
                        pm["env"].add(qq["env"])
                        pm["tags"].add(qq["tag"])
                        if qq["mode"] == "mechanism":
                            pm["tags"].add("机制研究")
                        continue
                    for key in keys:
                        records_by_identity[key] = rec
                    new_records.append(rec)
                    n_got += 1
        except oa_runtime.PipelineError:
            qstat.append({"q": qq["q"], "env": qq["env"], "total_hits": total_hits,
                          "downloaded": n_downloaded, "incomplete": True})
            qstat.extend({"q": x["q"], "env": x["env"], "incomplete": True,
                          "status": "not_started"} for x in queries[qi+1:])
            oa_runtime.atomic_json(os.path.join(BASE, "logs", f"qstat-{today}.json"), qstat)
            raise
        qstat.append({"q": qq["q"], "env": qq["env"], "tag": qq["tag"],
                      "total_hits": total_hits, "downloaded": n_downloaded,
                      "new_kept": n_got, "incomplete": False})
        oa_runtime.atomic_json(os.path.join(BASE, "logs", f"qstat-{today}.json"), qstat)
    print(f"本次新增: {len(new_records)} 篇")
    # 保存 per-query 记账
    oa_runtime.atomic_json(os.path.join(BASE, "logs", f"qstat-{today}.json"), qstat)
    n_inc = sum(1 for s in qstat if s["incomplete"])
    print(f"查询组记账：{len(qstat)} 组，总命中 {sum(s['total_hits'] or 0 for s in qstat)}，未完成 {n_inc} 组")
    # 跨环境命中合并（即使没有全新文献也可能发生）
    n_merged = 0
    if pending_merge:
        for k, pm in pending_merge.items():
            x = pm['record']
            if not x:
                continue
            before = (set(x.get("env") or []), set(x.get("tags") or []))
            x["env"] = sorted(set(x.get("env") or []) | pm["env"])
            x["tags"] = sorted(set(x.get("tags") or []) | pm["tags"])
            if (set(x["env"]), set(x["tags"])) != before:
                n_merged += 1
        if n_merged:
            oa_runtime.atomic_json(merged_p, merged)
        print(f"跨环境标签合并: {n_merged} 篇")
    if new_records:
        # 2026-10-11: 任务来源和入库时间标记（GPT 网页端"每日新增"只显示当天增量）
        incremental_run = not full and not dis
        ingest_time = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
        ingest_day = ingest_time.date().isoformat()
        # authorships 缓存落盘
        apath = os.path.join(BASE, "data", "authorships.json")
        try:
            auth_cache = json.load(open(apath, encoding="utf-8"))
        except FileNotFoundError:
            auth_cache = {}
        for rec in new_records:
            rec["ingest_kind"] = "incremental" if incremental_run else "historical"
            rec["ingested_at"] = ingest_time.isoformat()
            auths = rec.pop("_authorships", None)
            wid = (rec["id"] or "").split("/")[-1]
            if auths:
                auth_cache[wid] = auths
            merged.append(rec)
        oa_runtime.atomic_json(apath, auth_cache)
        merged.sort(key=lambda x: (-(x.get("year") or 0), -(x.get("cited") or 0)))
        oa_runtime.atomic_json(merged_p, merged)
        # 每日新增记录：只有增量运行才写入，历史回填不算"每日新增"
        # 2026-10-11: 未标记的旧记录不显示，避免历史补录算成今日新增
        if incremental_run:
            dpath = os.path.join(BASE, "data", "daily_new.json")
            try:
                daily = json.load(open(dpath, encoding="utf-8"))
            except FileNotFoundError:
                daily = {}
            existing_today = [r for r in daily.get(ingest_day, []) if r.get("ingest_kind") == "incremental"]
            batch_daily = [{
                "id": r["id"], "doi": r["doi"], "title": r["title"], "year": r["year"],
                "authors": r["authors"][:6], "journal": r["journal"],
                "cited": r["cited"], "type": r["type"], "env": r["env"], "tags": r["tags"],
                "ingest_kind": r["ingest_kind"], "ingested_at": r["ingested_at"],
            } for r in new_records]
            daily[ingest_day] = list({r["id"]: r for r in existing_today + batch_daily}.values())
            days = sorted(daily.keys())[-30:]
            daily = {d: daily[d] for d in days}
            # Keep the complete daily ledger; rendering limits belong in UI.
            oa_runtime.atomic_json(dpath, daily)
    # 被引刷新（支撑“被引飙升”预警；无新增时也可能触发重建）
    try:
        n_ref, n_surge = refresh_cited(merged)
    except Exception as e:
        print(f"被引刷新未完成（采集状态独立）: {oa_runtime.redact(e)}")
        oa_runtime.atomic_json(os.path.join(BASE, 'logs', f'citation-status-{today}.json'),
                               {'status': 'incomplete', 'reason': type(e).__name__})
        n_ref, n_surge = 0, 0
    if new_records or n_merged or n_ref or n_surge:
        # 保存 merged（含被引刷新结果）
        oa_runtime.atomic_json(merged_p, merged)
        # 重算画像
        print("重算 analytics.json…")
        subprocess.run([sys.executable, os.path.join(BASE, "aggregate_analytics.py")],
                       check=True)
        # Data jobs must never rebuild a stale site template or mutate its code.
        print('数据已更新；网页构建和公开发布由独立验收流程执行。')
        # 同步文献数据到 Supabase 私有存储（前端登录后从云端拉取）
        print("跳过云端同步（待人工抽查后手动发布）")
    else:
        print("无新增，无需重建。")

    oa_runtime.atomic_json(state_p, {"last_run": d1})
    # Preserve prior pending decisions and full source evidence across retries.
    if PENDING_REVIEW:
        for item in PENDING_REVIEW:
            guard.review(BASE, item, item.get('reason', 'requires_review'), env=item.get('env', ''))
    print(f"完成，last_run={d1}")

if __name__ == "__main__":
    main()
