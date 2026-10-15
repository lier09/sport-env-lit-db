(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LitdbFollow=factory();})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  function key(value){return String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();}
  function create(api){
    var d=api.document,w=api.window,escape=api.escape;
    var state={tab:'au',name:'',query:'',page:1,size:20,sort:'year',discovery:''};
    var opened=false,returnFocus=null,returnHash='#z-search',returnScroll=0,indexLength=-1,index={au:new Map(),jo:new Map()},visibleNames=[];
    function $(id){return d.getElementById(id);}
    function ensureIndex(){
      var papers=api.papers();if(indexLength===papers.length)return;
      indexLength=papers.length;index={au:new Map(),jo:new Map()};
      function add(mode,name,p){var k=key(name);if(!k)return;var row=index[mode].get(k);if(!row){row={name:name,papers:[]};index[mode].set(k,row);}if(row.papers[row.papers.length-1]!==p)row.papers.push(p);}
      papers.forEach(function(p){(p.authors||[]).forEach(function(n){add('au',n,p);});add('jo',p.journal,p);});
    }
    function papersFor(name,tab){ensureIndex();var row=index[tab||state.tab].get(key(name));return row?row.papers.filter(function(p){return !api.deleted(p.id);}):[];}
    function followed(){return api.follows()[state.tab==='au'?'authors':'journals'];}
    function isFollowed(){return Object.keys(followed()).some(function(n){return key(n)===key(state.name);});}
    function routeHash(){return '#following?'+new URLSearchParams({tab:state.tab,name:state.name}).toString();}
    function saveRoute(){if(opened)w.history.replaceState(null,'',routeHash());}
    function select(name){state.name=name;state.query='';state.page=1;$('folPaperQuery').value='';saveRoute();render();}
    function renderNames(){
      var names=Object.keys(followed()),q=key(state.discovery),rows=[];
      if(q){ensureIndex();index[state.tab].forEach(function(row){if(key(row.name).includes(q)){var count=row.papers.filter(function(p){return !api.deleted(p.id);}).length;if(count)rows.push({name:row.name,count:count});}});rows.sort(function(a,b){return b.count-a.count||a.name.localeCompare(b.name);});}
      else rows=names.map(function(n){return {name:n,count:papersFor(n).length};});
      visibleNames=rows.slice(0,40);
      $('folDirectoryMeta').textContent=q?'找到 '+rows.length+' 个'+(state.tab==='au'?'作者':'期刊')+(rows.length>40?'，请缩小搜索范围':''):'已关注 '+names.length+' 个'+(state.tab==='au'?'作者':'期刊');
      $('folList').innerHTML=visibleNames.map(function(row,i){return '<button type="button" class="follow-person'+(key(row.name)===key(state.name)?' selected':'')+'" data-person="'+i+'" aria-pressed="'+(key(row.name)===key(state.name))+'"><span class="follow-initial" aria-hidden="true">'+escape(row.name.slice(0,1).toUpperCase())+'</span><span class="follow-person-text"><strong>'+escape(row.name)+'</strong><small>库内 '+row.count+' 篇</small></span><span aria-hidden="true">›</span></button>';}).join('')||'<div class="follow-empty">'+(q?'未找到匹配项，请尝试期刊全名或作者姓名。':'还没有关注。搜索库内作者或期刊，选择后点击“关注”。')+'</div>';
    }
    function render(){
      if(!$('folList'))return;
      $('folTabAu').classList.toggle('on',state.tab==='au');$('folTabJo').classList.toggle('on',state.tab==='jo');
      $('folTabAu').setAttribute('aria-pressed',state.tab==='au');$('folTabJo').setAttribute('aria-pressed',state.tab==='jo');
      var names=Object.keys(followed());if(!state.name&&names.length)state.name=names[0];
      if(opened)renderNames();
      $('folAuthorCount').textContent=Object.keys(api.follows().authors).length;$('folJournalCount').textContent=Object.keys(api.follows().journals).length;
      $('folSelected').textContent=state.name||(state.tab==='au'?'选择一位作者':'选择一本期刊');
      $('folScope').textContent=state.tab==='au'?'仅显示本数据库已收录的文献；同名作者可能需要结合机构核对。':'仅显示本数据库已收录的文献，按期刊全名匹配。';
      $('folToggle').hidden=!state.name;$('folToggle').textContent=isFollowed()?'已关注 · 取消关注':'＋ 关注';$('folToggle').setAttribute('aria-pressed',isFollowed());
      var all=state.name?papersFor(state.name):[],q=key(state.query);
      var list=all.filter(function(p){return !q||key([p.title,p.abstract,p.journal,(p.tags||[]).join(' ')].join(' ')).includes(q);});
      list.sort(state.sort==='cited'?function(a,b){return b.cited-a.cited||b.year-a.year;}:function(a,b){return b.year-a.year||b.cited-a.cited;});
      var pages=Math.max(1,Math.ceil(list.length/state.size));state.page=Math.min(state.page,pages);
      var start=(state.page-1)*state.size,shown=list.slice(start,start+state.size);
      $('folPaperCount').textContent='库内全部 '+all.length+' 篇'+(q?' · 筛选后 '+list.length+' 篇':'');
      $('folPaginationInfo').textContent='第 '+state.page+' / '+pages+' 页 · '+(list.length?start+1:0)+'–'+(start+shown.length)+' / '+list.length+' 篇';
      $('folPrev').disabled=state.page<=1;$('folNext').disabled=state.page>=pages;
      $('folPapers').innerHTML=shown.map(function(p){
        var abstract=p.abstract||'',preview=abstract.slice(0,240),au=(p.authors||[]).join(', ');
        return '<article class="follow-paper" data-paper="'+escape(p.id)+'"><div class="follow-paper-badges">'+api.badges(p)+'</div><h3><button type="button" class="follow-title" data-read="'+escape(p.id)+'">'+escape(p.title)+'</button></h3><p class="follow-paper-meta">'+escape(au)+'<br>'+escape(p.journal||'期刊未标注')+' · '+escape(p.year||'年份未标注')+' · 被引 '+p.cited+'</p>'+
          (abstract?'<p class="follow-preview">'+escape(preview)+(abstract.length>240?'…':'')+'</p><details class="follow-abstract"><summary>查看完整摘要</summary><div>'+escape(abstract)+'</div></details>':'<p class="follow-paper-meta">原始来源暂无摘要，可打开阅读器查看全文入口。</p>')+
          '<div class="follow-paper-actions"><button type="button" class="btn" data-read="'+escape(p.id)+'">打开阅读器</button><button type="button" class="btn ghost" data-fav="'+escape(p.id)+'" aria-pressed="'+api.favorited(p.id)+'">'+(api.favorited(p.id)?'已收藏':'收藏')+'</button></div></article>';
      }).join('')||'<div class="follow-empty follow-empty-large"><strong>'+(state.name?'暂无符合条件的文献':'从关注对象开始阅读')+'</strong><p>'+(state.name?'可以清空文献关键词，或选择其他作者／期刊。':'在左侧选择已关注对象，或搜索库内作者和期刊。全部文献和摘要将在这里显示。')+'</p></div>';
    }
    function open(push){
      if(!opened){returnHash=w.location.hash.startsWith('#following')||w.location.hash==='#z-follow'?'#z-search':w.location.hash||'#z-search';returnScroll=w.scrollY||0;returnFocus=d.activeElement;}
      opened=true;api.enter();$('followHub').hidden=false;d.body.classList.add('follow-open');
      if(push!==false)w.history.pushState(null,'',routeHash());render();w.scrollTo(0,0);$('followHeading').focus({preventScroll:true});
    }
    function close(push){if(!opened)return;opened=false;$('followHub').hidden=true;d.body.classList.remove('follow-open');api.leave();if(push!==false)w.history.pushState(null,'',returnHash);w.scrollTo(0,returnScroll);if(returnFocus&&returnFocus.isConnected&&!$('followHub').contains(returnFocus))returnFocus.focus({preventScroll:true});}
    function route(){
      var hash=w.location.hash;
      if(hash.startsWith('#following')||hash==='#z-follow'){
        var params=new URLSearchParams(hash.split('?')[1]||'');state.tab=params.get('tab')==='jo'?'jo':'au';state.name=params.get('name')||'';state.query='';state.discovery='';$('folPaperQuery').value='';$('folSearch').value='';state.page=1;open(false);
      }else close(false);
    }
    function bind(){
      var root=$('followHub');if(root._bound)return;root._bound=true;
      d.addEventListener('click',function(e){var link=e.target.closest('[data-follow-open]');if(link){e.preventDefault();open();}});
      root.addEventListener('click',function(e){
        var b=e.target.closest('button');if(!b)return;
        if(b.id==='folBack'){close();return;}
        if(b.id==='folTabAu'||b.id==='folTabJo'){state.tab=b.id==='folTabAu'?'au':'jo';state.name='';state.discovery='';state.query='';state.page=1;$('folSearch').value='';$('folPaperQuery').value='';render();saveRoute();return;}
        if(b.hasAttribute('data-person')){select(visibleNames[Number(b.dataset.person)].name);return;}
        if(b.id==='folToggle'){var actual=Object.keys(followed()).find(function(n){return key(n)===key(state.name);})||state.name;api.toggle(state.tab,actual);render();return;}
        if(b.hasAttribute('data-read')){api.read(b.dataset.read);return;}
        if(b.hasAttribute('data-fav')){api.favorite(b.dataset.fav);render();return;}
        if(b.id==='folPrev'||b.id==='folNext'){state.page+=b.id==='folPrev'?-1:1;render();$('folResultsHead').scrollIntoView({block:'start'});}
      });
      var timer;$('folSearch').addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(function(){state.discovery=$('folSearch').value;renderNames();},180);});
      $('folSearch').addEventListener('keydown',function(e){if(e.key==='Enter'){clearTimeout(timer);state.discovery=this.value;renderNames();}});
      $('folPaperQuery').addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(function(){state.query=$('folPaperQuery').value;state.page=1;render();},180);});
      $('folSort').onchange=function(){state.sort=this.value;state.page=1;render();};$('folPageSize').onchange=function(){state.size=Number(this.value);state.page=1;render();};
      w.addEventListener('hashchange',route);w.addEventListener('popstate',route);
    }
    return {bind:bind,render:render,open:open,close:close,route:route,isOpen:function(){return opened;},papersFor:papersFor};
  }
  return {create:create,key:key};
});
