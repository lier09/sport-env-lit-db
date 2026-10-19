/* On-demand full text. No API calls, PDF downloads or PDF runtime at startup. */
(function () {
  'use strict';
  var w = window, d = document, paper, work, controller, generation = 0, pdfTask, pdfDoc, renderTask;
  var modulePromise, blobURL, focusBefore, pageNumber = 1, zoom = 1, textMode = false, rendering = 0;
  var sessionKey = '', KEY = 'litdb-openalex-content-key', MAX = 80 * 1024 * 1024;
  var ROOT = './vendor/pdfjs-6.4.299/', api = {};
  function $(id) { return d.getElementById(id); }
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function https(value) { try { var u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch (_) { return ''; } }
  function workId(p) { var m = String(p.id || p.libraryId || '').match(/^(?:https:\/\/openalex\.org\/)?(W\d+)$/i); return m ? m[1].toUpperCase() : ''; }
  function doi(p) { return String(p.doi || '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').trim(); }
  function key() { return sessionKey; }
  function notice(text, error) { $('ftStatus').textContent = text; $('ftStatus').classList.toggle('error', !!error); }
  function shell() {
    if ($('fulltextDialog')) return;
    var el = d.createElement('dialog'); el.id = 'fulltextDialog'; el.setAttribute('aria-labelledby', 'ftTitle');
    el.innerHTML = '<header class="ft-header"><div><small>全文阅读</small><h2 id="ftTitle"></h2></div><button type="button" class="ft-btn" id="ftClose" aria-label="关闭全文阅读">关闭 ×</button></header>' +
      '<div class="ft-actions"><button type="button" class="ft-btn primary" id="ftRetry">获取全文</button><label class="ft-btn">上传本地 PDF<input type="file" id="ftUpload" accept="application/pdf,.pdf" hidden></label><a id="ftDownload" class="ft-btn" hidden download="paper.pdf">下载 PDF</a><a id="ftSource" class="ft-btn" target="_blank" rel="noopener noreferrer" hidden>来源网页 ↗</a><button type="button" class="ft-btn" id="ftSettings" aria-expanded="false" aria-controls="ftConfig">OpenAlex 设置</button></div>' +
      '<form id="ftConfig" hidden><div><label for="ftKey">OpenAlex API Key</label><input id="ftKey" type="password" autocomplete="off" spellcheck="false" placeholder="粘贴你自己的 OpenAlex 密钥"><button class="ft-btn primary" type="submit">应用并获取全文</button><button class="ft-btn" id="ftForget" type="button">清除密钥</button></div><label class="ft-remember"><input id="ftRemember" type="checkbox">记住在此浏览器</label><p>OpenAlex 存档 PDF 下载需要密钥，使用账户的每日额度。默认仅本次页面使用，密钥只发往 OpenAlex。<a href="https://openalex.org/settings/api" target="_blank" rel="noopener noreferrer">获取免费密钥 ↗</a></p></form>' +
      '<p id="ftStatus" role="status" aria-live="polite"></p><div id="ftTools" class="ft-tools" hidden><button type="button" class="ft-btn" id="ftPrev" aria-label="上一页">← 上一页</button><label>页码 <input id="ftPage" type="number" min="1" value="1"></label><span id="ftTotal"></span><button type="button" class="ft-btn" id="ftNext" aria-label="下一页">下一页 →</button><button type="button" class="ft-btn" id="ftMinus" aria-label="缩小">−</button><span id="ftZoom">100%</span><button type="button" class="ft-btn" id="ftPlus" aria-label="放大">＋</button><button type="button" class="ft-btn" id="ftText" aria-pressed="false">文字阅读</button></div>' +
      '<div id="ftViewport" tabindex="0" aria-label="论文全文"><div id="ftEmpty"><strong>按需获取，留在当前页面阅读</strong><p>支持 OpenAlex 存档 PDF、可直接读取的公开 PDF，以及本地上传。</p></div><canvas id="ftCanvas" role="img" aria-label="论文 PDF 当前页" hidden></canvas><pre id="ftTextPage" hidden></pre></div>';
    d.body.appendChild(el);
    $('ftClose').onclick = close;
    el.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape') e.stopPropagation(); });
    el.addEventListener('close', cleanup);
    $('ftSettings').onclick = function () { config($('ftConfig').hidden); };
    $('ftRetry').onclick = fetchFull;
    $('ftForget').onclick = function () { sessionKey = ''; $('ftKey').value = ''; $('ftRemember').checked = false; try { w.localStorage.removeItem(KEY); } catch (_) {} notice('已清除 OpenAlex 密钥。'); };
    $('ftConfig').onsubmit = function (e) { e.preventDefault(); sessionKey = $('ftKey').value.trim(); try { if ($('ftRemember').checked && sessionKey) w.localStorage.setItem(KEY, sessionKey); else w.localStorage.removeItem(KEY); } catch (_) { notice('浏览器无法记住密钥，本次仍可使用。'); } config(false); fetchFull(); };
    $('ftUpload').onchange = function () { var f = this.files[0]; this.value = ''; if (!f) return; var gen = start(); notice('正在打开本地 PDF…'); load(f, gen, '本地上传 · ' + (f.name || 'PDF')).catch(function (e) { if (gen === generation) showError(e); }); };
    $('ftPrev').onclick = function () { if (pageNumber > 1) { pageNumber--; draw().catch(showError); } };
    $('ftNext').onclick = function () { if (pdfDoc && pageNumber < pdfDoc.numPages) { pageNumber++; draw().catch(showError); } };
    $('ftPage').onchange = function () { pageNumber = Math.max(1, Math.min(pdfDoc ? pdfDoc.numPages : 1, Math.round(Number(this.value) || 1))); draw().catch(showError); };
    $('ftMinus').onclick = function () { zoom = Math.max(.5, zoom - .25); draw().catch(showError); };
    $('ftPlus').onclick = function () { zoom = Math.min(2, zoom + .25); draw().catch(showError); };
    $('ftText').onclick = function () { textMode = !textMode; draw().catch(showError); };
  }
  function config(show) { $('ftConfig').hidden = !show; $('ftSettings').setAttribute('aria-expanded', String(show)); if (show) $('ftKey').focus(); }
  function disposePDF() {
    rendering++; if (renderTask) { renderTask.cancel(); renderTask = null; }
    var task = pdfTask; pdfTask = null; pdfDoc = null; if (task) Promise.resolve(task.destroy()).catch(function () {});
    if (blobURL) { URL.revokeObjectURL(blobURL); blobURL = null; }
    var c = $('ftCanvas'); if (c) { c.width = c.height = 0; c.hidden = true; }
    if ($('ftDownload')) { $('ftDownload').hidden = true; $('ftDownload').removeAttribute('href'); }
    if ($('ftTextPage')) { $('ftTextPage').hidden = true; $('ftTextPage').textContent = ''; }
    if ($('ftTools')) $('ftTools').hidden = true;
  }
  function start() { generation++; if (controller) controller.abort(); controller = new AbortController(); disposePDF(); $('ftEmpty').hidden = false; $('ftRetry').disabled = true; return generation; }
  function cleanup() { generation++; if (controller) controller.abort(); disposePDF(); if (focusBefore && focusBefore.isConnected) focusBefore.focus({preventScroll:true}); }
  function close() { if ($('fulltextDialog') && $('fulltextDialog').open) $('fulltextDialog').close(); }
  function showError(e) { if (e && e.name === 'AbortError') return; notice(e && e.message || '全文加载失败，请重试或上传 PDF。', true); $('ftRetry').disabled = false; }
  function fetchFull() { var result = resolve(), gen = generation; result.catch(function (e) { if (gen === generation) showError(e); }); }
  async function request(url, kind, signal, gen) {
    var abort = new AbortController(), timer, chunks = [], bytes = 0, limit = kind === 'pdf' ? MAX : 2 * 1024 * 1024;
    function reset() { clearTimeout(timer); timer = setTimeout(function () { abort.abort(); }, kind === 'pdf' ? 45000 : 20000); }
    function cancel() { abort.abort(); }
    signal.addEventListener('abort', cancel, {once:true}); if (signal.aborted) abort.abort(); reset();
    try {
      var r = await w.fetch(url, {credentials:'omit', cache:'no-store', referrerPolicy:'no-referrer', signal:abort.signal});
      if (!r.ok) { var err = new Error(r.status === 401 || r.status === 403 ? '来源拒绝访问，请检查 OpenAlex 密钥或改用本地 PDF。' : r.status === 429 ? 'OpenAlex 请求或每日额度受限，请稍后重试。' : '全文来源返回 HTTP ' + r.status + '，可重试或上传 PDF。'); err.status = r.status; throw err; }
      if (Number(r.headers.get('content-length')) > limit) throw new Error('文件超过允许大小（PDF 最大 80 MB）。');
      if (r.body && r.body.getReader) {
        var reader = r.body.getReader();
        while (true) { var next = await reader.read(); if (next.done) break; reset(); bytes += next.value.byteLength; if (bytes > limit) { await reader.cancel(); throw new Error('文件超过允许大小（PDF 最大 80 MB）。'); } chunks.push(next.value); if (kind === 'pdf' && gen === generation) notice('正在获取全文 · ' + (bytes / 1024 / 1024).toFixed(1) + ' MB'); }
      } else { var buffer = await r.arrayBuffer(); bytes = buffer.byteLength; if (bytes > limit) throw new Error('文件过大。'); chunks.push(new Uint8Array(buffer)); }
      var blob = new Blob(chunks, {type:kind === 'pdf' ? 'application/pdf' : 'application/json'});
      return kind === 'pdf' ? blob : JSON.parse(await blob.text());
    } catch (e) { if (abort.signal.aborted && !signal.aborted) throw new Error('连接或下载超时，请重试。'); if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); throw e; }
    finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
  }
  function setSource(url) { var safe = https(url); $('ftSource').hidden = !safe; if (safe) $('ftSource').href = safe; else $('ftSource').removeAttribute('href'); }
  async function resolve() {
    var gen = start(), signal = controller.signal, p = paper, id = workId(p), identifier = id || (doi(p) ? 'doi:' + encodeURIComponent(doi(p)) : ''), metaError;
    notice('正在查询本篇论文的全文来源…'); work = null;
    if (identifier) {
      try { var u = new URL('https://api.openalex.org/works/' + identifier); u.searchParams.set('select', 'id,doi,title,has_content,content_urls,best_oa_location'); if (key()) u.searchParams.set('api_key', key()); work = await request(u.href, 'json', signal, gen); }
      catch (e) { if (e.name === 'AbortError') throw e; metaError = e; }
    }
    if (gen !== generation) return;
    var archived = work && work.has_content && work.has_content.pdf && workId(work), location = work && work.best_oa_location;
    var publicPDF = https(location && location.pdf_url || p.pdf_url), source = https(location && location.landing_page_url) || (doi(p) ? 'https://doi.org/' + doi(p) : publicPDF);
    setSource(source); var lastError;
    if (archived && key()) {
      notice('正在获取 OpenAlex 存档 PDF…');
      try { var content = new URL('https://content.openalex.org/works/' + archived + '.pdf'); content.searchParams.set('api_key', key()); var blob = await request(content.href, 'pdf', signal, gen); if (gen !== generation) return; await load(blob, gen, 'OpenAlex 存档'); return; }
      catch (e) { if (e.name === 'AbortError') throw e; lastError = e; }
    }
    if (publicPDF) {
      // Keys must never be forwarded to publisher/repository URLs.
      notice('正在尝试读取公开 PDF…');
      try { var publicBlob = await request(publicPDF, 'pdf', signal, gen); if (gen !== generation) return; await load(publicBlob, gen, '公开来源'); return; }
      catch (e) { if (e.name === 'AbortError') throw e; lastError = e; }
    }
    if (gen !== generation) return;
    $('ftRetry').disabled = false;
    if (archived && !key()) { config(true); notice('OpenAlex 有这篇论文的 PDF。填入免费 API Key 后即可在这里阅读；也可上传本地 PDF。'); }
    else if (lastError || metaError) { notice((lastError && lastError.status || metaError && metaError.status) === 429 ? 'OpenAlex 请求或每日额度受限，请稍后重试或上传 PDF。' : '暂时无法直接读取全文，可能是网络、密钥或来源跨域限制。可打开来源网页，或上传本地 PDF。', true); if (archived || metaError && [401,403].includes(metaError.status)) config(true); }
    else notice('当前未找到可直接读取的全文。可打开来源网页，或上传本地 PDF；这不影响摘要与笔记。');
  }
  function library() {
    if (!modulePromise) modulePromise = (api.loadLibrary ? api.loadLibrary() : import(ROOT + 'pdf.mjs')).then(function (lib) { lib.GlobalWorkerOptions.workerSrc = new URL(ROOT + 'pdf.worker.mjs', d.baseURI).href; return lib; }).catch(function (e) { modulePromise = null; throw e; });
    return modulePromise;
  }
  async function load(blob, gen, origin) {
    try {
      if (blob.size > MAX) throw new Error('PDF 超过 80 MB。');
      var buffer = await blob.arrayBuffer(), header = new TextDecoder().decode(buffer.slice(0, 1024));
      if (!header.includes('%PDF-')) throw new Error('来源未返回有效 PDF，可能是登录页或网页。请上传 PDF 文件。');
      var lib = await library(); if (gen !== generation) return;
      var task = lib.getDocument({data:new Uint8Array(buffer), cMapUrl:new URL(ROOT + 'cmaps/', d.baseURI).href, cMapPacked:true, standardFontDataUrl:new URL(ROOT + 'standard_fonts/', d.baseURI).href, wasmUrl:new URL(ROOT + 'wasm/', d.baseURI).href, iccUrl:new URL(ROOT + 'iccs/', d.baseURI).href, isEvalSupported:false});
      pdfTask = task; task.onPassword = function () { notice('这是加密 PDF，请上传可直接打开的副本。', true); task.destroy(); };
      var doc = await task.promise; if (gen !== generation) { await task.destroy(); return; } pdfDoc = doc;
      pageNumber = 1; zoom = 1; textMode = false;
      blobURL = URL.createObjectURL(blob); $('ftDownload').href = blobURL; $('ftDownload').download = (paper.title || 'paper').replace(/[\\/:*?"<>|]/g, '_').slice(0, 160) + '.pdf'; $('ftDownload').hidden = false;
      $('ftTools').hidden = false; $('ftEmpty').hidden = true; config(false); notice(origin + ' · ' + doc.numPages + ' 页 · 本次阅读按需加载，关闭后释放。');
      await draw();
    } catch (e) { if (gen === generation) disposePDF(); throw e; }
    finally { if (gen === generation) $('ftRetry').disabled = false; }
  }
  async function draw() {
    if (!pdfDoc) return;
    var token = ++rendering, doc = pdfDoc, number = pageNumber;
    if (renderTask) { var previous = renderTask; renderTask = null; previous.cancel(); try { await previous.promise; } catch (_) {} }
    var page = await doc.getPage(number); if (token !== rendering || doc !== pdfDoc) return;
    $('ftPage').value = number; $('ftPage').max = doc.numPages; $('ftTotal').textContent = '/ ' + doc.numPages + ' 页'; $('ftZoom').textContent = Math.round(zoom * 100) + '%';
    $('ftPrev').disabled = number <= 1; $('ftNext').disabled = number >= doc.numPages; $('ftMinus').disabled = zoom <= .5; $('ftPlus').disabled = zoom >= 2;
    $('ftText').setAttribute('aria-pressed', String(textMode)); $('ftText').textContent = textMode ? '原版 PDF' : '文字阅读';
    $('ftCanvas').hidden = textMode; $('ftTextPage').hidden = !textMode;
    if (textMode) {
      var text = await page.getTextContent(); if (token !== rendering) return;
      $('ftTextPage').textContent = text.items.map(function (t) { return t.str + (t.hasEOL ? '\n' : ' '); }).join('') || '本页没有可提取文字，可能为扫描页，请切回原版 PDF。';
    } else {
      var base = page.getViewport({scale:1}), width = Math.max(280, Math.min(1100, $('ftViewport').clientWidth - 40));
      var view = page.getViewport({scale:width / base.width * zoom}), ratio = Math.min(2, w.devicePixelRatio || 1), canvas = $('ftCanvas');
      canvas.width = Math.ceil(view.width * ratio); canvas.height = Math.ceil(view.height * ratio); canvas.style.width = view.width + 'px'; canvas.style.height = view.height + 'px';
      canvas.setAttribute('aria-label', '论文 PDF 第 ' + number + ' 页，共 ' + doc.numPages + ' 页');
      renderTask = page.render({canvasContext:canvas.getContext('2d'), viewport:view, transform:ratio === 1 ? null : [ratio,0,0,ratio,0,0]});
      try { await renderTask.promise; } catch (e) { if (e.name !== 'RenderingCancelledException') throw e; }
      if (token === rendering) renderTask = null;
    }
    if (token === rendering) $('ftViewport').scrollTo(0, 0);
  }
  function open(p) {
    shell(); paper = p; work = null; if (!$('fulltextDialog').open) focusBefore = d.activeElement;
    try { sessionKey = sessionKey || w.localStorage.getItem(KEY) || ''; $('ftRemember').checked = !!w.localStorage.getItem(KEY); } catch (_) {}
    $('ftKey').value = sessionKey; $('ftTitle').textContent = p.title || '论文全文'; setSource(doi(p) ? 'https://doi.org/' + doi(p) : https(p.pdf_url));
    if (!$('fulltextDialog').open) $('fulltextDialog').showModal(); config(false); fetchFull();
  }
  w.LitdbFulltext = {open:open, close:close, isOpen:function () { return !!($('fulltextDialog') && $('fulltextDialog').open); }, configure:function (config) { api = config || {}; }};
})();
