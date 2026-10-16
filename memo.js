/* ---------- 备忘录 Memo (IndexedDB 本地存储, 支持工作台+经典双布局) ---------- */
(function(){
"use strict";
var DB_NAME = "litdb-memo", DB_VER = 1, db = null;
var memoList = [], memoFilter = "";

function openDB(){
  return new Promise(function(resolve, reject){
    var req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = function(e){
      var d = e.target.result;
      if(!d.objectStoreNames.contains("memos")){
        var ms = d.createObjectStore("memos", {keyPath: "id", autoIncrement: true});
        ms.createIndex("created", "created", {unique: false});
        ms.createIndex("paperId", "paperId", {unique: false});
      }
      if(!d.objectStoreNames.contains("files")) d.createObjectStore("files", {keyPath: "id", autoIncrement: true});
    };
    req.onsuccess = function(e){ db = e.target.result; resolve(db); };
    req.onerror = function(e){ reject(e); };
  });
}
function tx(s, m){ return db.transaction([s], m || "readonly").objectStore(s); }
function addMemo(m){
  return new Promise(function(res, rej){
    m.created = Date.now(); m.updated = Date.now();
    var r = tx("memos", "readwrite").add(m);
    r.onsuccess = function(e){ res(e.target.result); }; r.onerror = rej;
  });
}
function getMemos(){
  return new Promise(function(res, rej){
    var out = [], r = tx("memos").index("created").openCursor(null, "prev");
    r.onsuccess = function(e){ var c = e.target.result; if(c){ out.push(c.value); c.continue(); } else res(out); };
    r.onerror = rej;
  });
}
function deleteMemo(id){
  return new Promise(function(res, rej){
    var r = tx("memos", "readwrite").delete(id);
    r.onsuccess = function(){ res(); }; r.onerror = rej;
  });
}
function updateMemo(m){
  return new Promise(function(res, rej){
    m.updated = Date.now();
    var r = tx("memos", "readwrite").put(m);
    r.onsuccess = function(){ res(); }; r.onerror = rej;
  });
}
function saveFile(f){
  return new Promise(function(res, rej){
    var rd = new FileReader();
    rd.onload = function(){
      var rec = {name: f.name, type: f.type, size: f.size, data: rd.result, created: Date.now()};
      var r = tx("files", "readwrite").add(rec);
      r.onsuccess = function(e){ res(e.target.result); }; r.onerror = rej;
    };
    rd.onerror = rej; rd.readAsArrayBuffer(f);
  });
}
function getFile(id){
  return new Promise(function(res, rej){
    var r = tx("files").get(id);
    r.onsuccess = function(e){ res(e.target.result); }; r.onerror = rej;
  });
}
function parseRIS(t){
  var rs = [], cur = {};
  t.split(/\r?\n/).forEach(function(l){
    var m = l.match(/^([A-Z][A-Z0-9])\s*-\s?(.*)$/);
    if(!m) return;
    var tag = m[1], val = m[2].trim();
    if(tag === "TY"){ if(cur.TY) rs.push(cur); cur = {TY: val, AU: [], KW: []}; }
    else if(tag === "ER"){ rs.push(cur); cur = {}; }
    else if(tag === "AU" || tag === "A1") cur.AU.push(val);
    else if(tag === "KW") cur.KW.push(val);
    else { if(cur[tag] && tag !== "TY") cur[tag] += "; " + val; else cur[tag] = val; }
  });
  if(cur.TY) rs.push(cur);
  return rs;
}
function risToMemo(r){
  var p = [];
  if(r.TI) p.push("标题: " + r.TI);
  if(r.AU && r.AU.length) p.push("作者: " + r.AU.join("; "));
  if(r.JO || r.JF) p.push("期刊: " + (r.JO || r.JF));
  if(r.PY) p.push("年份: " + r.PY);
  if(r.DO) p.push("DOI: " + r.DO);
  if(r.AB) p.push("\n摘要: " + r.AB);
  if(r.KW && r.KW.length) p.push("\n关键词: " + r.KW.join("; "));
  return {kind: "ris", title: r.TI || "(无标题)", body: p.join("\n"), ris: r, paperId: null, fileIds: []};
}
function esc(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function fmtSize(b){ if(b < 1024) return b + "B"; if(b < 1048576) return (b/1024).toFixed(1) + "KB"; return (b/1048576).toFixed(1) + "MB"; }
function fmtDate(t){ var d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0") + " " + String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0"); }

async function renderMemoList(){
  var lists = [document.getElementById("memoList"), document.getElementById("memoList2")].filter(Boolean);
  if(!lists.length) return;
  memoList = await getMemos();
  var q = memoFilter.toLowerCase();
  var fl = memoList.filter(function(m){ return !q || (m.title + " " + m.body).toLowerCase().indexOf(q) >= 0; });
  var html = fl.length ? fl.map(function(m){
    var ic = m.kind === "image" ? "🖼" : m.kind === "pdf" ? "📄" : m.kind === "ris" ? "📚" : "📝";
    var fi = (m.fileIds && m.fileIds.length) ? '<div class="memo-files">' + m.fileIds.map(function(f,i){ return '<button class="btn btn-xs" data-mfile="'+f+'">附件'+(i+1)+'</button>'; }).join(" ") + "</div>" : "";
    var pt = m.paperId ? '<span class="memo-paper">📎 ' + esc(m.paperId) + "</span>" : "";
    return '<div class="memo-card"><div class="memo-head"><span class="memo-kind">'+ic+'</span><span class="memo-title">'+esc(m.title||"(无标题)")+"</span>"+pt+'<span class="memo-date">'+fmtDate(m.created)+"</span></div>"+
      '<div class="memo-body">'+esc((m.body||"").slice(0,300))+((m.body||"").length>300?"…":"")+"</div>"+fi+
      '<div class="memo-actions"><button class="btn btn-xs" data-mview="'+m.id+'">查看</button> <button class="btn btn-xs" data-medit="'+m.id+'">编辑</button> <button class="btn btn-xs btn-danger" data-mdel="'+m.id+'">删除</button></div></div>';
  }).join("") : '<div class="memo-empty">暂无备忘录，点上面新建一条吧</div>';
  lists.forEach(function(el){
    el.innerHTML = html;
    el.querySelectorAll("[data-mview]").forEach(function(b){ b.onclick = function(){ viewMemo(+b.dataset.mview); }; });
    el.querySelectorAll("[data-medit]").forEach(function(b){ b.onclick = function(){ editMemo(+b.dataset.medit); }; });
    el.querySelectorAll("[data-mdel]").forEach(function(b){ b.onclick = function(){ if(confirm("确定删除？")) deleteMemo(+b.dataset.mdel).then(renderMemoList); }; });
    el.querySelectorAll("[data-mfile]").forEach(function(b){ b.onclick = function(e){ e.stopPropagation(); downloadFile(+b.dataset.mfile); }; });
  });
}
async function downloadFile(fid){
  var f = await getFile(fid); if(!f) return alert("文件不存在");
  var u = URL.createObjectURL(new Blob([f.data], {type: f.type}));
  var a = document.createElement("a"); a.href = u; a.download = f.name;
  document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(u); a.remove(); }, 1000);
}
async function viewMemo(id){
  var m = memoList.find(function(x){ return x.id === id; }); if(!m) return;
  var fl = "";
  if(m.fileIds && m.fileIds.length){
    fl = "<p><b>附件:</b><br>" + (await Promise.all(m.fileIds.map(async function(fid){
      var f = await getFile(fid); return f ? '<a href="#" data-dl="'+fid+'">'+esc(f.name)+" ("+fmtSize(f.size)+")</a>" : "";
    }))).join("<br>") + "</p>";
  }
  showMemoModal(esc(m.title || "(无标题)"), '<pre class="memo-fullbody">' + esc(m.body || "") + "</pre>" + fl, null);
  document.querySelectorAll("[data-dl]").forEach(function(a){ a.onclick = function(e){ e.preventDefault(); downloadFile(+a.dataset.dl); }; });
}
function showMemoModal(t, bh, onSave){
  var ov = document.getElementById("memoModal");
  if(!ov){
    ov = document.createElement("div"); ov.id = "memoModal"; ov.className = "memo-modal-ov";
    ov.innerHTML = '<div class="memo-modal"><div class="memo-modal-head"><span id="memoModalTitle"></span><button class="btn btn-xs" id="memoModalX">✕</button></div><div class="memo-modal-body" id="memoModalBody"></div><div class="memo-modal-foot" id="memoModalFoot"></div></div>';
    document.body.appendChild(ov);
    document.getElementById("memoModalX").onclick = function(){ ov.style.display = "none"; };
    ov.onclick = function(e){ if(e.target === ov) ov.style.display = "none"; };
  }
  document.getElementById("memoModalTitle").textContent = t;
  document.getElementById("memoModalBody").innerHTML = bh;
  var ft = document.getElementById("memoModalFoot"); ft.innerHTML = "";
  if(onSave){ var b = document.createElement("button"); b.className = "btn"; b.textContent = "保存"; b.onclick = onSave; ft.appendChild(b); }
  ov.style.display = "flex"; return ov;
}
function memoFormHTML(m){
  m = m || {};
  return '<label>标题<br><input id="memoFTitle" class="memo-input" value="'+esc(m.title||"")+'"></label><br><br>'+
    '<label>备注<br><textarea id="memoFBody" class="memo-input memo-textarea" rows="6">'+esc(m.body||"")+"</textarea></label><br><br>"+
    '<label>关联文献ID (可选)<br><input id="memoFPaper" class="memo-input" value="'+esc(m.paperId||"")+'" placeholder="如 OpenAlex ID"></label><br><br>'+
    '<label>附件 (图片/PDF)<br><input type="file" id="memoFFile" multiple accept="image/*,.pdf"></label>';
}
function newMemo(){
  showMemoModal("新建备忘录", memoFormHTML(), async function(){
    var ti = document.getElementById("memoFTitle").value.trim(), bo = document.getElementById("memoFBody").value.trim();
    var pi = document.getElementById("memoFPaper").value.trim() || null;
    if(!ti && !bo){ alert("标题和备注至少填一个"); return; }
    var fids = [], fi = document.getElementById("memoFFile");
    if(fi && fi.files.length) for(var i = 0; i < fi.files.length; i++) fids.push(await saveFile(fi.files[i]));
    var kind = "text";
    if(fids.length){ var f0 = await getFile(fids[0]); if(f0 && f0.type.indexOf("image") === 0) kind = "image"; else if(f0 && f0.type === "application/pdf") kind = "pdf"; }
    await addMemo({kind: kind, title: ti, body: bo, paperId: pi, fileIds: fids});
    document.getElementById("memoModal").style.display = "none"; renderMemoList();
  });
}
async function editMemo(id){
  var m = memoList.find(function(x){ return x.id === id; }); if(!m) return;
  showMemoModal("编辑备忘录", memoFormHTML(m), async function(){
    m.title = document.getElementById("memoFTitle").value.trim();
    m.body = document.getElementById("memoFBody").value.trim();
    m.paperId = document.getElementById("memoFPaper").value.trim() || null;
    var fi = document.getElementById("memoFFile");
    if(fi && fi.files.length) for(var i = 0; i < fi.files.length; i++){ m.fileIds = m.fileIds || []; m.fileIds.push(await saveFile(fi.files[i])); }
    await updateMemo(m); document.getElementById("memoModal").style.display = "none"; renderMemoList();
  });
}
async function importRIS(f){
  var rs = parseRIS(await f.text());
  if(!rs.length){ alert("RIS 文件中没有解析到记录"); return; }
  for(var i = 0; i < rs.length; i++) await addMemo(risToMemo(rs[i]));
  alert("已导入 " + rs.length + " 条文献备忘录"); renderMemoList();
}
async function initMemo(){
  try { await openDB(); } catch(e){ console.error("Memo DB 打开失败", e); return; }
  [["memoNew","memoRIS","memoSearch"],["memoNew2","memoRIS2","memoSearch2"]].forEach(function(ids){
    var b = document.getElementById(ids[0]); if(b) b.onclick = newMemo;
    var r = document.getElementById(ids[1]); if(r) r.onchange = function(){ if(r.files.length) importRIS(r.files[0]); r.value = ""; };
    var s = document.getElementById(ids[2]); if(s) s.oninput = function(){ memoFilter = s.value; renderMemoList(); };
  });
  renderMemoList();
}
window.MemoQuickAdd = async function(pid, pti){
  await openDB();
  showMemoModal("给文献加备注", memoFormHTML({title: pti || "", paperId: pid}), async function(){
    var bo = document.getElementById("memoFBody").value.trim(); if(!bo){ alert("备注内容不能为空"); return; }
    await addMemo({kind: "text", title: document.getElementById("memoFTitle").value.trim(), body: bo, paperId: pid, fileIds: []});
    document.getElementById("memoModal").style.display = "none"; renderMemoList();
  });
};
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", initMemo); else initMemo();
})();
