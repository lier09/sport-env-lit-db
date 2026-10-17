/* Curated thinking prompts. Sources inform methods, not a validated taxonomy or efficacy claim. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LitdbParadigmGuide=factory();})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
var sources={
 recovery:{title:'Recovery and Performance in Sport: Consensus Statement',year:2018,url:'https://doi.org/10.1123/ijspp.2017-0759',note:'用于理解恢复、表现及个体内外变化；不能把恢复感受等同于表现恢复。'},
 consort:{title:'CONSORT 2025 statement',year:2025,url:'https://www.bmj.com/content/389/bmj-2024-081123',note:'随机试验报告依据：预设结局、清楚描述设计、报告结果及不确定性。'},
 crossover:{title:'CONSORT extension to randomised crossover trials',year:2019,url:'https://www.bmj.com/content/366/bmj.l4378',note:'交叉试验需说明序列、周期、洗脱及潜在残留效应；并非所有适应研究都适合交叉设计。'},
 tidier:{title:'TIDieR checklist and guide',year:2014,url:'https://www.bmj.com/content/348/bmj.g1687',note:'用于明确干预成分、实施方式、剂量、时程与实际执行情况。'},
 response:{title:'True and false interindividual differences in the physiological response to an intervention',year:2015,url:'https://doi.org/10.1113/EP085070',note:'个体响应分析要区分真实差异、测量误差与自然波动。'},
 precis:{title:'The PRECIS-2 tool: designing trials that are fit for purpose',year:2015,url:'https://www.bmj.com/content/350/bmj.h2147',note:'用于思考研究条件与实际应用情境的匹配；不是干预有效性评分。'},
 heat:{title:'Consensus recommendations on training and competing in the heat',year:2015,url:'https://bjsm.bmj.com/content/49/18/1164',note:'提供热适应与运动前／中降温等情境示例；不据此外推其他干预的效果。'},
 load:{title:'IOC consensus statement on load in sport and risk of injury',year:2016,url:'https://bjsm.bmj.com/content/50/17/1030',note:'为训练与比赛负荷、表现和身心状态的同步记录提供背景。'}
};
var applications=[
 {science:[0,1,3,4,5,10],outcomes:[1,2,3],times:[0,1],refs:['tidier','consort','response'],checks:['先分清刺激本身与运动引起的变化。','设置可信对照，记录剂量与连续反应。'],questions:{0:'在没有运动干扰的条件下，刺激与对照的预设结局是否不同？',1:'强度或持续时间改变时，反应是否呈阈值或平台？',3:'反应从何时出现，何时达峰，停用后如何消退？',5:'把温度、压力或机械成分分别控制后，还能观察到什么？'}},
 {science:[0,1,2,4,8,10],outcomes:[0,1,4],times:[0,1],refs:['heat','tidier','consort','crossover'],checks:['同时记录起始状态与随后的运动任务。','比较时机时，尽量区分时间变化与剂量变化。'],questions:{0:'改变运动前状态后，实际运动表现是否也改变？',1:'相同运动前窗口内，不同刺激剂量的结果怎样？',2:'距运动开始不同提前量，能否产生不同结果？',8:'相同准备干预，对耐力、冲刺和力量任务是否一致？'}},
 {science:[0,1,3,4,8,11],outcomes:[0,1,2],times:[0],refs:['heat','tidier','precis','consort'],checks:['区分固定负荷测试与自主配速测试。','同时观察过程反应和最终任务结果。'],questions:{0:'在同一运动任务中，干预是否改变预设表现？',1:'不同氧浓度、冷却强度或其他剂量与反应怎样关联？',3:'干预开始与停止后，过程指标如何随时间变化？',11:'在真实天气、补给和比赛节奏下，结果是否仍适用？'}},
 {science:[0,1,2,3,4,10,12],outcomes:[0,1,4],times:[0,1,2],refs:['recovery','tidier','crossover','response'],checks:['用多个时点描述恢复轨迹，避免只看一次测量。','把主观恢复、功能恢复和再次表现分别判断。'],questions:{0:'与对照相比，预设恢复结局是否改变？',1:'不同剂量是否改变恢复速度，而不只改变某一时点的数值？',2:'立即介入与延迟介入，在可比剂量下是否不同？',3:'何时出现变化、何时恢复、轨迹是否发生改变？',4:'候选中间过程的变化，是否先于功能恢复？',10:'表面上的响应差异有多少可能来自误差与自然波动？',12:'一次恢复中的短期变化，与数周训练适应是否同向？'}},
 {science:[0,2,3,7,8,11],outcomes:[0,1,4],times:[0,1],refs:['recovery','crossover','tidier','precis'],checks:['明确第一次负荷、两次间隔与第二次任务。','下一次表现应与“感觉恢复”分开解释。'],questions:{0:'间歇期采用干预后，第二次运动任务是否改变？',2:'在固定的两次运动间隔中，何时介入更值得比较？',3:'短间隔与较长间隔下，反应轨迹是否不同？',7:'在同一恢复窗口内，两种恢复方式的结果怎样？',8:'迁移到第二次不同类型任务时，结果是否一致？'}},
 {science:[0,1,10,12,13],outcomes:[0,1,3],times:[2,3],refs:['load','consort','tidier','response'],checks:['记录训练负荷、干预执行与主要适应结局。','长期适应可能残留，不要机械套用交叉设计。'],questions:{0:'在可比训练安排下，额外干预是否改变训练适应？',1:'干预频次与总暴露改变时，训练适应如何变化？',10:'个体训练反应差异是否超出测量与自然变异？',12:'短期收益是否伴随不同方向的长期变化？',13:'每次训练使用与分阶段使用，是否产生不同结果？'}},
 {science:[1,3,4,10,12],outcomes:[1,2,3],times:[2,3],refs:['heat','tidier','response','consort'],checks:['区分干预适应与同时发生的训练适应。','观察适应形成、保持与消退；不预设存在迁移。'],questions:{1:'暴露强度、频次和累积剂量怎样关联适应形成？',3:'适应何时形成，停用后如何保持或消退？',4:'同一刺激的反应改变，可能通过哪些过程出现？',10:'适应速度的个体差异是否稳定、可重复？',12:'一次急性反应，能否解释多次暴露后的变化？'}},
 {science:[0,4,8,9,11],outcomes:[0,1,3],times:[2,3],refs:['heat','consort','tidier','precis'],checks:['分别测量原刺激适应与目标刺激下的结果。','迁移是待检验假设，不能由相似机制直接推出。'],questions:{0:'对一种刺激适应后，在另一刺激情境中是否观察到差异？',4:'原情境和目标情境中，候选过程是否有共同变化？',8:'迁移是否依赖目标运动任务的类型？',9:'生理迁移与运动表现迁移是否同时出现？',11:'实验室观察到的迁移在实际环境中是否仍可观察？'}},
 {science:[2,7,11,12,13],outcomes:[0,4,5],times:[1,2,3],refs:['load','recovery','precis','consort'],checks:['先明确训练期、比赛期或恢复期的决策目标。','将收益、依从性和实际使用负担一起描述。'],questions:{2:'相同干预安排在不同训练或比赛阶段，结果如何？',7:'持续使用与阶段使用，结果和执行负担怎样权衡？',11:'真实赛历和依从性约束下，策略能否落实？',12:'短期表现需求与长期适应目标是否一致？',13:'什么条件下开始、暂停或改用另一种策略值得研究？'}}
];
function context(index){return applications[index]||applications[3];}
function question(app,science,fallback){return context(app).questions[science]||('放在当前应用情境中继续追问：'+fallback);}
return {sources:sources,applications:applications,context:context,question:question,reviewed:'2026-10-17',attribution:'子范式与结局／时间的连接由本站据方法学资料整理，用于启发研究；不是来源文献提出的统一分类，也不代表有效性证据。'};
});
