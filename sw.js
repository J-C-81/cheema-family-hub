const CACHE='cfh-v4';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(clients.claim()));

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
  
  // iOS Safari aggressively dedupes notifications that share a tag, even with
  // renotify:true — multiple rapid pushes collapse into a single silent one.
  // Use a unique tag per notification so each one always rings/buzzes.
  const options={
    body,
    icon:'https://j-c-81.github.io/cheema-family-hub/icon.png',
    badge:'https://j-c-81.github.io/cheema-family-hub/icon.png',
    tag:'cfh-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),
    renotify:true,
    requireInteraction:false,
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
