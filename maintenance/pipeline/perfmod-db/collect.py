"""运动表现建模与计算运动生理学数据库：采集。
title_and_abstract 检索建模相关短语，经建模信号+运动生理信号双重过滤，
剔除博彩/比分预测/球员追踪识别/纯CV等噪声。"""
import json, os, re, sys, time, urllib.parse

WORKSPACE = os.environ.get('LITDB_WORKSPACE', os.path.expanduser('~/workspace'))
BASE = os.path.join(WORKSPACE, 'perfmod-db')
os.makedirs(BASE + "/data", exist_ok=True)
sys.path.insert(0, os.path.join(WORKSPACE, 'cold-lit-db'))
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location(
    "cold_du", os.path.join(WORKSPACE, 'cold-lit-db', 'daily_update.py'))
du = _ilu.module_from_spec(_spec)
sys.modules["cold_du"] = du
_spec.loader.exec_module(du)

# 建模信号（标题/摘要至少命中其一）
MODEL_RX = re.compile(
    r"\bmodel|simulat|\bpredict|forecast|optim|uncertainty|sensitivity|"
    r"hierarchical|state.space|dynamical|digital twin|probabil|monte carlo|"
    r"bayesian|extreme value|longitudinal|mixed.effect|markov|regression|"
    r"calibrat|validat|algorithm|equation|computational", re.I)

# 运动生理信号（performance/training 单独出现太宽，必须与其他强信号共现；
# 强信号：明确的运动/生理词汇）
SPORT_STRONG_RX = re.compile(
    r"\bsport|athlet|exercis|physiolog|endurance|"
    r"cycling|cyclist|bicycle|bike\b|running|runner|swimming|swimmer|rowing|rower|"
    r"triathlon|triathlet|marathon|world record|kinesiol|time trial|oxygen uptake|VO2|"
    r"lactate|aerobic|anaerobic", re.I)
SPORT_WEAK_RX = re.compile(r"\bperformance\b|\btraining\b", re.I)

# 排除规则（两层）：
#  - _TITLE_JUNK：标题级精确打击（动物/临床/心理/描述性/杂项噪声；只看标题，
#    避免摘要里顺带提及动物实验、脑震荡等误伤正常文献）
#  - _FULL_JUNK：标题+摘要（博彩/比分预测/硬领域错配，一击即中）
_TITLE_JUNK = [
    # 动物实验（人类运动表现库不收动物研究）
    r"\brat\b", r"\brats\b", r"\bmouse\b", r"\bmice\b", "murine",
    "transgenic", "knockout mice", "knockout mouse", "gene knockout",
    "salmon", "zebrafish", "lizard", "equine", "thoroughbred", "horse racing",
    "fishery", r"\blarval\b", "sprague", "dystrophic", "6-hydroxydopamine",
    "standardbred", r"\bmares\b", "geldings", r"\bdog\b",
    # 心脏起搏（与配速 pacing 多义）
    "pacemaker", r"\bQRS\b", "endocardial", "bradycardia",
    "chamber pacing", "sick sinus", "ventricular pacing", "his bundle",
    "bundle branch", "biventricular", "paced.ecg",
    # 慢性疼痛/临床 activity pacing（与运动配速多义）
    "fibromyalgia", "chronic pain", "activity pacing", "multiple sclerosis",
    # 共识/立场声明（归共识库，不归建模库）
    "consensus statement", "consensus development", "position paper",
    "position stand", "summary statement",
    # 临床康复（非建模）
    "concussion", "traumatic brain injury", "osteoarthritis", "postpartum",
    "low back pain", "patellar instability", "exercise therapy program",
    "knee function deficits", "anterior cruciate ligament reconstructed",
    "hepatic steatosis", "vascular function in overweight",
    "autonomic cardiovascular function",
    "left ventricular assist", "ventricular assist device",
    "total knee arthroplasty", "sensorimotor deficits",
    "morphology of lower limb muscles", "step.up height",
    "primary care patients", "parathyroid hormone", "osteoporotic women",
    "triple.hop", "y.balance test",
    "knee contact force asymmetries", "return.to.sport readiness",
    "stationary cycling too early",
    "active physiotherapy on knee function",
    "motivations for physical activity",
    "leading and learning through crisis",
    # 运动心理/神经/社会学非建模
    "mindfulness", "mental imagery", r"\bimagery\b",
    "intrinsic and extrinsic motivation", "athlete branding",
    "bullying in sport", "birthplace and birthdate",
    "music performance anxiety", "motivational climate",
    "neural plasticity", "athletic identity", "adherence and affect",
    "self.concept", "executive function", "wellness scores",
    "big.fish", "little.pond", "ambulatory monitoring",
    "heritability", "heritage family",
    # 描述性/测量学（非建模）
    "7.day physical activity recall", "triaxial accelerometer",
    "percentiles", "body composition changes", "tackling ability",
    "brains and sprains", "breast support", r"ac.dc score",
    "gap.oriented assessment", "foot characteristics",
    "lunge landings", "ankle control",
    # 会议日程条目（非正式论文）：poster session / free communication 摘要集条目
    r"free communication/poster", r"thematic poster", r"^[a-z]-\d+\s",
    # 社论/研讨会通告/病例报告（非研究论文）
    r"^editorial\b", r"^symposium\b", r"\bcase report\b",
    # 队列简介/队医临床/卒中临床（纯临床，非建模）
    r"cohort profile", r"team physician",
    r"chronic stroke|stroke patients|stroke rehabilitation",
    # 杂项已确认噪声
    "assessing scientific models", "cannabidiol",
    r"\beconomic\b", "copula",
    "district energy", "residential occupant",
    "building performance evaluation", "athletic training facility",
]
_FULL_JUNK = [
    # 博彩 / 比分预测 / 球员追踪 / 纯CV / 计量
    "betting", "gambling", "bookmaker", r"\bodds\b", "match outcome",
    "match result", "score prediction", "football prediction",
    "soccer prediction", "player tracking", "player identification",
    "player detection", "action recognition", "fantasy sport", "transfer fee",
    "salary cap", "econometric",
    # 非体育领域的方法学噪声（硬错配）
    "option pricing", r"black\.scholes", "sunk cost",
    "early exercise boundary", "asian options",
    "covariance matrices", "realized volatility",
    r"\bRePEc\b", r"\bNBER\b", r"\bDSGE\b", "business cycle",
    "macroecon",
    "hydrolog", "geotechnical", "traffic stream", "autonomous vehicle",
    "radioactive waste", "geologic disposal", "pharmacoeconomic",
    "shakespeare", "synthetic aperture", "scuffmark", "rotor model",
    "pump/turbine", "recommender", r"\brecsys\b",
    "commitment pacing", "national systems of innovation",
    "soul bound token", r"peer\.to\.peer", "head coach dismissals?",
    # 肠道菌群等非建模主题
    "gut microbiota", "gut microbiome",
]
TITLE_JUNK_RX = re.compile("|".join(_TITLE_JUNK), re.I)
EXCLUDE_RX = re.compile("|".join(_FULL_JUNK), re.I)


# "exercise" 作"练习/演练"解的固定搭配，需先剔除再做运动信号判定
FALSE_EXERCISE_RX = re.compile(
    r"(forecasting|modeling|modelling|thought|empirical|estimation|statistical|"
    r"econometric|numerical|computational) exercise", re.I)


# 无摘要特例：OpenAlex 无摘要时只能看标题；标题有核心建模主题 + 体育期刊
# 的论文放行（否则 "Describing and Understanding Pacing Strategies…" 这类
# 无摘要综述会被 MODEL_RX 误杀）。有摘要的仍要求建模信号。
REVIEW_TOPIC_RX = re.compile(
    r"pacing|critical power|critical speed|power.duration|speed.duration|"
    r"training.performance|impulse.response|digital twin|w prime", re.I)
SPORT_JOURNAL_RX = re.compile(
    r"sport|exercis|athlet|kinesiol|strength and conditioning", re.I)


def keep_record(title, abstract, journal, oa_type=""):
    t = (title or "") + " " + (abstract or "")
    if TITLE_JUNK_RX.search(title or ""):
        return False
    if EXCLUDE_RX.search(t):
        return False
    t2 = FALSE_EXERCISE_RX.sub("", t)
    has_sport = bool(SPORT_STRONG_RX.search(t2))
    if not has_sport and SPORT_WEAK_RX.search(t) and SPORT_JOURNAL_RX.search(journal or ""):
        has_sport = True
    if not has_sport:
        return False
    if MODEL_RX.search(t):
        return True
    # 无摘要特例
    if not (abstract or "").strip() and REVIEW_TOPIC_RX.search(title or "") \
            and SPORT_JOURNAL_RX.search(journal or ""):
        return True
    return False


def save(records):
    records.sort(key=lambda x: (-(x.get("cited") or 0)))
    du.oa_runtime.atomic_json(BASE + "/data/perfmod.json", records)


def fetch_query(q):
    params = {"filter": f"title_and_abstract.search:{q}",
              "select": du.SELECT, "per-page": 50}
    out = []
    info = {"q": q, "pages": 0, "incomplete": True}
    for data in du.oa_runtime.iter_pages(params):
        info["pages"] += 1
        out.extend(data["results"])
    info.update(incomplete=False, downloaded=len(out))
    return out, info


# 方法标签（13）：标题+摘要关键词宽松映射。真正的清洗由 keep_record/final_ok 完成。
_METHOD_PATTERNS = [
    ("临界功率", r"critical power"),
    ("临界速度", r"critical speed"),
    ("功率-时间建模", r"power.duration|speed.duration|\bw[′’']|w prime|work capacity"),
    ("配速建模", r"\bpac(?:ing|e)\b|pacing strateg|time.trial|race strateg|even.pac|fast.start|parabolic|negative.split"),
    ("优化控制", r"\boptimi|\boptimal\b|control theor|optimal control|dynamic program|feedback control"),
    ("个体差异", r"individual (response|variation|difference)|inter.individual|intra.individual|between.subject|subject.specific|personaliz|responder|non.responder"),
    ("纵向/分层", r"longitudinal|hierarchical|mixed.effect|multi.level|multilevel|state.space|random.effect|latent growth"),
    ("能量代谢建模", r"energetics|energy (system|expenditure|metabolism|demand)|metabolic|oxygen uptake kinetics|vo2 kinetics|oxygen deficit|atp turnover"),
    ("生物力学建模", r"biomechan|musculoskeletal|muscle model|inverse dynamics|joint (torque|moment|power)|finite element|tendon|muscle.tendon"),
    ("不确定性", r"uncertainty|sensitivity analysis"),
    ("贝叶斯/概率", r"bayesian|probabil|monte carlo|markov|extreme value|stochastic"),
    ("训练-表现模型", r"training.performance|impulse.response|banister|fitness.fatigue|dose.response|performance management"),
    ("数字孪生", r"digital twin|computational athlete|virtual athlete|in silico|\bavatar\b"),
]


def detect_methods(title, abstract):
    t = ((title or "") + " " + (abstract or "")).lower()
    return [tag for tag, pat in _METHOD_PATTERNS if re.search(pat, t)]


_REVIEW_T_RX = re.compile(
    r"\breview\b|meta.analysis|systematic review|scoping review|umbrella review|"
    r"state.of.the.art|literature review|narrative review|research synthesis", re.I)
_THEORY_T_RX = re.compile(
    r"\btheor|conceptual|framework|perspective|commentary|methodolog|"
    r"\btutorial\b|\bprimer\b|hypothesis|proposal", re.I)
REVIEW_RX = _REVIEW_T_RX
CODE_RX = re.compile(
    r"github\.com|gitlab\.|open.?source|open.?code|open.?data|"
    r"code (?:is |was )?available|software (?:is |was )?available|"
    r"\bmatlab\b|\br package\b|zenodo|osf\.io", re.I)


def detect_type(title):
    t = title or ""
    if _REVIEW_T_RX.search(t):
        return "综述"
    if _THEORY_T_RX.search(t):
        return "理论/方法"
    return "研究论文"


def record_from(r, tag):
    title = (r.get("title") or "").strip()
    if not title:
        return None
    journal = ((r.get("primary_location") or {}).get("source") or {}).get("display_name")
    abstract = du.recon_abstract(r.get("abstract_inverted_index"))
    if not keep_record(title, abstract, journal, r.get("type") or ""):
        return None
    authors = []
    for a in (r.get("authorships") or []):
        an = ((a.get("author") or {}).get("display_name") or "").strip()
        if an:
            authors.append(an)
    boa = r.get("best_oa_location") or {}
    t = (title or "") + " " + (abstract or "")
    return {
        "id": r.get("id"), "doi": du.norm_doi(r.get("doi")),
        "title": title, "year": r.get("publication_year"),
        "authors": authors[:12], "journal": journal,
        "cited": r.get("cited_by_count") or 0,
        "methods": detect_methods(title, abstract),
        "query_tag": tag,
        "type": detect_type(title),
        "has_code": bool(CODE_RX.search(t)),
        "is_review": bool(REVIEW_RX.search(title or "")),
        "oa_type": r.get("type") or "",
        "abstract": abstract,
        "pdf_url": boa.get("pdf_url"),
    }


def main():
    raise du.oa_runtime.PipelineError('Legacy full collector disabled; use run_pipeline.py --job perfmod')
    queries = json.load(open(BASE + "/data/queries.json", encoding="utf-8"))
    try:
        records = json.load(open(BASE + "/data/perfmod.json", encoding="utf-8"))
    except FileNotFoundError:
        records = []
    seen = set()
    for r in records:
        seen.add((r.get("doi") or "") or ("T:" + du.norm_title(r.get("title") or "")))
    try:
        done = set(json.load(open(BASE + "/data/_progress.json", encoding="utf-8")))
    except Exception:
        done = set()
    print(f"续跑：已载入 {len(records)} 篇", flush=True)
    for qq in queries:
        q = qq["q"]
        if q in done:
            print(f"  [{q}] 已完成，跳过", flush=True)
            continue
        n_new = 0
        recs, _qinfo = fetch_query(q)
        for r in recs:
            rec = record_from(r, qq["tag"])
            if not rec:
                continue
            k = (rec["doi"] or "") or ("T:" + du.norm_title(rec["title"]))
            if k in seen:
                continue
            seen.add(k)
            records.append(rec)
            n_new += 1
        done.add(q)
        du.oa_runtime.atomic_json(BASE + "/data/_progress.json", sorted(done))
        save(records)
        print(f"  [{q}] 新增 {n_new}，累计 {len(records)}", flush=True)
    save(records)
    print(f"建模库: {len(records)} 篇")


if __name__ == "__main__":
    main()


# ---- 数据底座终检规则（clean.py 并入，供 daily_update 复用）----
PHRASE = {
 '临界功率': [r'critical power'],
 '临界速度': [r'critical speed', r'critical velocity'],
 '功率-时间建模': [r'power.duration'],
 '速度-时间建模': [r'speed.duration'],
 "W'做功能力": [r"w prime", r"w'", r'anaerobic work capacity'],
 '配速建模': [r'pacing'],
 '最优配速': [r'optimal pacing', r'pacing'],
 '比赛表现建模': [r'race performance', r'performance model'],
 '训练-表现模型': [r'training.performance', r'performance model', r'impulse.response'],
 '刺激-反应模型': [r'impulse.response'],
 'Banister模型': [r"banister(?:['’]s)?[\s-]+(model|trimp|impulse|training impulse)|"
                r"banister et\.?\s*(al\.?|coll\.?)|"
                r"mod[eè]le\s+de\s+banister|"
                r"banister.{0,120}model|model.{0,120}banister"],
 '运动能量学建模': [r'energetics'],
 '代谢建模': [r'metabolic model', r'metabolism model', r'metabolic.*simulat'],
 '数字孪生': [r'digital twin'],
 '计算运动生理学': [r'computational'],
 '计算运动员': [r'computational athlete'],
 '贝叶斯建模': [r'bayesian'],
 '蒙特卡洛模拟': [r'monte carlo'],
 '极值建模': [r'extreme value'],
 '分层建模': [r'hierarchical|multilevel|mixed.effect'],
 '状态空间模型': [r'state.space'],
 '动力系统建模': [r'dynamical system'],
 '不确定性量化': [r'uncertainty'],
 '敏感性分析': [r'sensitivity analysis'],
 '个体反应建模': [r'individual response', r'responder', r'individual variation', r'trainability'],
 '肌肉骨骼建模': [r'musculoskeletal'],
 '表现预测': [r'performance prediction', r'predict'],
 '概率建模': [r'probabil'],
 '纵向建模': [r'longitudinal'],
 '优化控制建模': [r'optimal control', r'control theor', r'controller'],
}
NEG = {
 '临界功率': re.compile(r'divertor|fusion|plasma|tokamak|nuclear|electrical|power grid|infrastructure', re.I),
 '配速建模': re.compile(r'cardiac|pacemaker|heart|bradycardia|QRS|endocardial|chamber pacing|'
                        r'sick sinus|fibromyalgia|chronic pain|activity pacing|'
                        r'pork|innovation|recommender|commitment pacing|'
                        r'phrenic|diaphragm pacing|\bventilators?\b|ventilator-dependent', re.I),
 '最优配速': re.compile(r'cardiac|pacemaker|heart|bradycardia|QRS|endocardial|chamber pacing|'
                        r'sick sinus|fibromyalgia|chronic pain|activity pacing|'
                        r'pork|innovation|recommender|commitment pacing|'
                        r'phrenic|diaphragm pacing|\bventilators?\b|ventilator-dependent', re.I),
 '刺激-反应模型': re.compile(r'econometric|financial|\bmonetary\b|stock market|\beconomic\b|'
                             r'macroeconomic|\bDSGE\b|business cycle|\bRePEc\b|pork', re.I),
 '运动能量学建模': re.compile(r'divertor|fusion|plasma|tokamak', re.I),
 # 政策分析/临床治疗类非建模噪声（标题+摘要）
 '分层建模': re.compile(r'\bpolic', re.I),
 '肌肉骨骼建模': re.compile(r'shockwave|growth plate|physeal|nutrition assessment', re.I),
}
# 补剂/干预类 meta 分析：不是表现建模，剔除（标题含建模核心短语的除外）
SUPP_RX = re.compile(
    r'supplement|ketone|nitrate|caffeine|betaine|ashwagandha|\bingestion\b|'
    r'testosterone|cortisol|c.?reactive protein|set volume|multiple sets|'
    r'trainability|protein ingestion', re.I)
META_RX = re.compile(r'meta.analysis|systematic review|randomized|randomised|'
                     r'controlled (study|trial)|\bRCT\b', re.I)
CORE_KEEP_RX = re.compile(
    r'pacing|critical power|power.duration|speed.duration|dose.response|'
    r'performance prediction|performance estimation|talent identification|'
    r'training intensity distribution|submaximal|fitness test', re.I)
# 明显非体育领域的刊物/来源：直接剔除（标题规则抓不住的通用方法学噪声）
NONSPORT_J_RX = re.compile(
    r'RePEc|Econometric Theory|Finance and Economics Discussion Series|'
    r'Empirical Economics|Asian Economic Papers|African Journal of Economic|'
    r'Advances in economics|Contributions to economics|'
    r'Journal of Global Health Economics|National Bureau of Economic Research|'
    r'Athens University of Economics|'
    r'Hydrological Processes|Hydrology and earth system sciences|'
    r'Water Resources Research|International Journal of Climatology|'
    r'Journal of Geotechnical and Geoenvironmental|'
    r'28th International Hydrology and Water Resources Symposium|'
    r'Transportation Research Record|'
    r'EP Europace|European Heart Journal|'
    r'Pacing and Clinical Electrophysiology|Heart Rhythm|'
    r'Frontiers in Cardiovascular Medicine|'
    r'Shakespeare bulletin|Anthem Press eBooks|'
    r'ACM Conference on Recommender|Defense Technical Information Center|'
    r'Journal of Mechanical Design|Accident Reconstruction Journal|'
    r'Dongfang Electric Review|Artificial Organs|JTCVS Open|'
    r'Hepatology|Toxicological Sciences|'
    r'Communication in Statistics|Journal of Statistical Computation and Simulation|'
    r'Probability in the Engineering and Informational|'
    r'Structure and Infrastructure Engineering|'
    r'Frontiers in Pharmacology|Agricultural Economics|'
    r'American Fisheries Society|Marine Ecology Progress Series|'
    r'Journal of Experimental Biology|Mammalian Genome|'
    r'Risk Analysis|The MIT Press eBooks|'
    r'International Journal of MS Care|'
    r'Thammasat University Digital Collections|'
    r'Illinois Digital Environment for Access|'
    r'OSTI OAI|'
    r'Psychology of Music|\bMindfulness\b|'
    r'Frontiers in Oncology|\bICAE\b|Documentos de Trabajo', re.I)
NEED_MODEL = {'不确定性量化', '敏感性分析', '纵向建模', '分层建模',
              '计算运动生理学', '个体反应建模'}
MODEL_W = re.compile(r'model|simulat', re.I)
COMP_SPORT = re.compile(r'exercis|physiolog|athlet|\bsport\b', re.I)
STRICT = {'纵向建模', '不确定性量化', '敏感性分析', '分层建模', '计算运动生理学',
          '个体反应建模', '优化控制建模', '状态空间模型', '动力系统建模',
          '表现预测', '概率建模', '代谢建模', '运动能量学建模'}
SPORT_J = re.compile(r'sport|exercis|athlet|kinesiol|strength and conditioning', re.I)


CORE_TITLE_RX = re.compile(
    r"pacing|critical power|critical speed|power.duration|speed.duration|"
    r"w prime|digital twin|banister|impulse.response|training.performance",
    re.I)


def final_ok(r):
    y = r.get('year')
    from datetime import date
    if y and (y < 1970 or y > date.today().year + 1):
        return False
    title, abstract, journal = r.get('title') or '', r.get('abstract') or '', r.get('journal') or ''
    if not keep_record(title, abstract, journal, r.get("oa_type") or ""):
        return False
    # 非体育领域刊物直接剔除（标题含核心建模短语的除外，如 RePEc 上的配速建模工作论文）
    if NONSPORT_J_RX.search(journal) and not CORE_TITLE_RX.search(title):
        return False
    # 补剂/干预类：标题含补剂干预词但无建模核心短语的不是表现建模
    # （meta 分析/RCT/普通研究一律适用；标题有 pacing/critical power 等核心词的除外）
    if SUPP_RX.search(title) and not CORE_KEEP_RX.search(title):
        return False
    t = title + ' ' + abstract
    tag = r.get('query_tag')
    pats = PHRASE.get(tag, [])
    if tag in STRICT:
        if not any(re.search(p, title, re.I) for p in pats):
            if not SPORT_J.search(journal):
                return False
    else:
        if not any(re.search(p, t, re.I) for p in pats):
            return False
    neg = NEG.get(tag)
    if neg and neg.search(t):
        return False
    if tag in NEED_MODEL and not MODEL_W.search(t):
        return False
    if tag == '计算运动生理学' and not COMP_SPORT.search(t):
        return False
    return True
