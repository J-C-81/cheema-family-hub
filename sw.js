const CACHE='cfh-v2';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(clients.claim()));

self.addEventListener('push',e=>{
  let d={title:'Cheema Family Hub',body:'Something new',tag:'cfh'};
  try{if(e.data)Object.assign(d,e.data.json());}catch{}
  e.waitUntil(self.registration.showNotification(d.title,{
    body:d.body,icon:'/icon.png',badge:'/icon.png',
    tag:d.tag,renotify:true,vibrate:[180,80,180],data:{url:'/'}
  }));
});

self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const c of list){if('focus' in c)return c.focus();}
    return clients.openWindow('/');
  }));
});
