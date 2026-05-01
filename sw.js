const CACHE='cfh-v6-0-0';
const ASSETS=[
  '/cheema-family-hub/manifest.json',
  '/cheema-family-hub/icon.png',
  '/cheema-family-hub/apple-touch-icon.png'
];

self.addEventListener('install',e=>{
  // Pre-cache the small set of static assets that never change between
  // versions so the PWA shell can boot fully offline.
  e.waitUntil(
    caches.open(CACHE)
      .then(c=>c.addAll(ASSETS).catch(()=>null))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',e=>{
  // Drop any old cache buckets from previous SW versions, then take over.
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>clients.claim())
  );
});

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  // Cache-first only for the small set of static assets we pre-cached.
  // index.html is intentionally NOT cached so version bumps roll out instantly.
  if(!ASSETS.some(a=>url.pathname===a))return;
  e.respondWith((async()=>{
    const cached=await caches.match(e.request);
    if(cached)return cached;
    try{
      const resp=await fetch(e.request);
      if(resp&&resp.ok){const c=await caches.open(CACHE);c.put(e.request,resp.clone());}
      return resp;
    }catch(err){
      if(cached)return cached;
      throw err;
    }
  })());
});

self.addEventListener('push',e=>{
  console.log('[SW] Push received');
  let title='Cheema Family Hub';
  let body='Something new added';
  try{
    if(e.data){
      const d=e.data.json();
      if(d.title)title=d.title;
      if(d.body)body=d.body;
    }
  }catch(err){
    try{body=e.data.text();}catch(e2){}
  }

  // Supermarket mode: client sends a "🛒 ... shops" title which is treated as
  // high-attention — sticky on Android (requireInteraction), stronger
  // vibration, and a shared tag so a second tap from the same shopper
  // replaces the previous notif instead of stacking. iOS Safari ignores
  // most of these flags but still shows the title/body, which is enough
  // because the 🛒 emoji and explicit copy are the visual signal.
  const isShopMode = title.includes('🛒') && /shop/i.test(title);
  // iOS Safari aggressively dedupes notifications that share a tag, even with
  // renotify:true — multiple rapid pushes collapse into a single silent one.
  // For normal pushes use a unique tag so each one always rings/buzzes.
  const options={
    body,
    icon:'https://j-c-81.github.io/cheema-family-hub/icon.png',
    badge:'https://j-c-81.github.io/cheema-family-hub/icon.png',
    tag: isShopMode ? 'cfh-shop-mode' : 'cfh-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),
    renotify:true,
    requireInteraction: isShopMode,
    vibrate: isShopMode ? [180,80,180,80,180,80,360] : undefined,
    data:{url:'https://j-c-81.github.io/cheema-family-hub/'}
  };

  e.waitUntil(
    self.registration.showNotification(title, options)
      .then(()=>console.log('[SW] Notification shown'))
      .catch(err=>console.log('[SW] Notification error:',err))
  );
});

self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(
    clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
      for(const c of list){if('focus' in c)return c.focus();}
      return clients.openWindow('https://j-c-81.github.io/cheema-family-hub/');
    })
  );
});
