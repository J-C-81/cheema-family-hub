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
  
  const options={
    body,
    icon:'https://j-c-81.github.io/cheema-family-hub/icon.png',
    badge:'https://j-c-81.github.io/cheema-family-hub/icon.png',
    tag:'cfh',
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
