const CACHE='cfh-v1';
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/'])));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(clients.claim());});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));});

self.addEventListener('push',e=>{
  let d={title:'Cheema Family Hub',body:'Something new — tap to open',tag:'cfh'};
  try{if(e.data){try{Object.assign(d,JSON.parse(e.data.text()))}catch{d.body=e.data.text()}}}catch(err){}
  e.waitUntil(self.registration.showNotification(d.title,{
    body:d.body,icon:'/icon-192.png',badge:'/icon-192.png',
    tag:d.tag,renotify:true,vibrate:[180,80,180],data:{url:'/'}
  }));
});

self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const c of list){if(c.url.includes(self.location.origin)&&'focus' in c)return c.focus();}
    return clients.openWindow('/');
  }));
});
