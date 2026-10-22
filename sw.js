/* 文献库 PWA Service Worker — 缓存外壳，数据与鉴权永远走网络 */
var CACHE = 'litdb-shell-91';
var SHELL = ['./', './index.html', './meta-core.js?v=87', './meta-hub.js?v=87', './meta-hub.css?v=87', './article-reader.js?v=88', './article-reader.css?v=88', './open-pdf-sources.json?v=91', './fulltext-reader.js?v=91', './fulltext-reader.css?v=88', './manifest.json', './jcr-data.js', './library-jcr.js', './follow-hub.js?v=79', './follow-hub.css', './memo.js?v=86', './memo.css?v=86', './figure-extract.js?v=80', './figure-hub.js?v=80', './figure-hub.css?v=80', './paradigm-guide.js?v=82', './assets/research-thinker.webp', './paradigm-rings.js?v=82', './paradigm-rings.css?v=82', './library-storage.js', './library-cache.js'];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){ return c.addAll(SHELL); })
      .then(function(){ return self.skipWaiting(); })
      .catch(function(){})
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k.indexOf('litdb-shell-')===0 && k!==CACHE; })
        .map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var url = e.request.url;
  // Supabase API / 认证 / 数据：一律走网络，不缓存
  if(url.indexOf('https://api.openalex.org/')===0 || url.indexOf('https://content.openalex.org/')===0)return;
  if(url.indexOf('supabase.co') >= 0 || url.indexOf('/auth/v1/') >= 0 || url.indexOf('/rest/v1/') >= 0 || url.indexOf('/storage/v1/') >= 0){
    return;
  }
  // PDF decoder assets are large: cache only when first requested by the PDF workspace.
  if(url.indexOf('/vendor/pdfjs-6.4.299/')>=0){
    e.respondWith(caches.open(CACHE).then(async function(c){var hit=await c.match(e.request);if(hit)return hit;var res=await fetch(e.request);if(res.ok)await c.put(e.request,res.clone());return res;}));return;
  }
  // 页面导航：网络优先，失败回退缓存
  if(e.request.mode === 'navigate'){
    e.respondWith(
      fetch(e.request).then(function(res){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put('./index.html', copy); });
        return res;
      }).catch(function(){ return caches.match('./index.html'); })
    );
    return;
  }
  // 静态资源：缓存优先
  e.respondWith(
    caches.match(e.request).then(function(hit){ return hit || fetch(e.request); })
  );
});
