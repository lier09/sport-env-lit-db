/* 文献库 PWA Service Worker — 缓存外壳，数据与鉴权永远走网络 */
var CACHE = 'litdb-shell-54';
var SHELL = ['./', './index.html', './manifest.json'];

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
  if(url.indexOf('supabase.co') >= 0 || url.indexOf('/auth/v1/') >= 0 || url.indexOf('/rest/v1/') >= 0 || url.indexOf('/storage/v1/') >= 0){
    return;
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
