// cfh-push worker — push relay + photo store for Cheema Family Hub.
//
// Secrets (set via Cloudflare API, NOT in source):
//   VAPID_PRIV  — VAPID private key (P-256, base64url scalar)
//   FB_AUTH     — Firebase RTDB legacy database secret, used as ?auth=
//   CFH_SYS_KEY — shared bearer for server-to-server callers (GH Actions)
//
// Bindings:
//   PHOTOS      — KV namespace for inline photo storage

const VAPID_PUB='BHeqNiEDdtZG2JXW-xhJxz8ARfkIPkyfgfQjt5rjf5a4I0nQJZYRqkPGXs-MnDkT6nc3W2lPH9IFlhGMzR4OJ-0';
const VAPID_SUB='mailto:jivancheemalfc@gmail.com';
const FB='https://cheema-79800-default-rtdb.europe-west1.firebasedatabase.app';

// Browsers calling the worker from the PWA send this Origin automatically.
const ALLOWED_ORIGINS=new Set(['https://j-c-81.github.io']);

function b64(buf){return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');}
function b64u(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}

async function makeJWT(audience,vapidPriv){
  const header=b64(new TextEncoder().encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const payload=b64(new TextEncoder().encode(JSON.stringify({
    aud:audience,
    exp:Math.floor(Date.now()/1000)+43200,
    sub:VAPID_SUB
  })));
  const data=`${header}.${payload}`;
  const jwk={
    kty:'EC',crv:'P-256',
    d:vapidPriv,
    x:b64(b64u(VAPID_PUB).slice(1,33)),
    y:b64(b64u(VAPID_PUB).slice(33,65)),
  };
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(data));
  return `${data}.${b64(sig)}`;
}

// WebCrypto HKDF is already extract+expand in one call; chaining two produced
// garbage keys that iOS couldn't decrypt (Apple still returned 201).
async function hkdf(salt,ikm,info,len){
  const k=await crypto.subtle.importKey('raw',ikm,{name:'HKDF'},false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},k,len*8));
}

async function encrypt(sub,title,body){
  const rPub=b64u(sub.keys.p256dh),auth=b64u(sub.keys.auth);
  const payload=new TextEncoder().encode(JSON.stringify({title,body,icon:'/cheema-family-hub/icon.png',tag:'cfh'}));
  const sk=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const sPubRaw=new Uint8Array(await crypto.subtle.exportKey('raw',sk.publicKey));
  const rk=await crypto.subtle.importKey('raw',rPub,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:rk},sk.privateKey,256));
  const info=new Uint8Array([...new TextEncoder().encode('WebPush: info\0'),...rPub,...sPubRaw]);
  const ikm=await hkdf(auth,shared,info,32);
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const cek=await hkdf(salt,ikm,new TextEncoder().encode('Content-Encoding: aes128gcm\0'),16);
  const nonce=await hkdf(salt,ikm,new TextEncoder().encode('Content-Encoding: nonce\0'),12);
  const ck=await crypto.subtle.importKey('raw',cek,{name:'AES-GCM'},false,['encrypt']);
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},ck,new Uint8Array([...payload,2])));
  const rs=new Uint8Array(4);new DataView(rs.buffer).setUint32(0,4096);
  return new Uint8Array([...salt,...rs,sPubRaw.length,...sPubRaw,...ct]);
}

async function sendOne(sub,title,body,vapidPriv){
  const ep=new URL(sub.endpoint);
  const jwt=await makeJWT(`${ep.protocol}//${ep.host}`,vapidPriv);
  const encrypted=await encrypt(sub,title,body);
  const res=await fetch(sub.endpoint,{
    method:'POST',
    headers:{
      'Authorization':`vapid t=${jwt},k=${VAPID_PUB}`,
      'Content-Type':'application/octet-stream',
      'Content-Encoding':'aes128gcm',
      'TTL':'86400',
      'Urgency':'normal',
    },
    body:encrypted
  });
  console.log('Push status:',res.status,'for',sub.endpoint.slice(0,50));
  return res.status;
}

const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET,POST,OPTIONS,HEAD'};
const json=(o,init={})=>new Response(JSON.stringify(o),{...init,headers:{...CORS,'Content-Type':'application/json',...(init.headers||{})}});

// Returns true if request is allowed: either Origin matches the PWA, or
// Authorization: Bearer matches the system key. Worker-to-worker calls pass
// the bearer; the PWA passes Origin (browser sets it automatically).
function authOK(req,env){
  const origin=req.headers.get('Origin')||'';
  if(ALLOWED_ORIGINS.has(origin))return true;
  const a=req.headers.get('Authorization')||'';
  if(env.CFH_SYS_KEY && a===`Bearer ${env.CFH_SYS_KEY}`)return true;
  return false;
}

export default {
  async fetch(req, env){
    if(req.method==='OPTIONS')return new Response('',{headers:CORS});
    const url=new URL(req.url);

    // ----- Photo upload: POST /photo, body = JPEG bytes -----
    if(url.pathname==='/photo' && req.method==='POST'){
      if(!authOK(req,env))return json({error:'forbidden'},{status:403});
      try{
        const ct=req.headers.get('Content-Type')||'application/octet-stream';
        if(!ct.startsWith('image/'))return json({error:'expected image/* content-type, got '+ct},{status:400});
        const buf=await req.arrayBuffer();
        if(buf.byteLength===0)return json({error:'empty body'},{status:400});
        if(buf.byteLength>5*1024*1024)return json({error:'photo too large (>5MB)'},{status:413});
        const id=crypto.randomUUID();
        await env.PHOTOS.put(id,buf,{metadata:{contentType:ct}});
        return json({url:`${url.origin}/photo/${id}`,id,size:buf.byteLength});
      }catch(e){
        return json({error:'upload failed: '+e.message},{status:500});
      }
    }

    // ----- Photo fetch: GET /photo/:id (public, intentionally no auth) -----
    if(url.pathname.startsWith('/photo/') && (req.method==='GET'||req.method==='HEAD')){
      try{
        const id=url.pathname.slice('/photo/'.length);
        if(!id || id.includes('/'))return new Response('bad id',{status:400,headers:CORS});
        const obj=await env.PHOTOS.getWithMetadata(id,{type:'arrayBuffer'});
        if(!obj || !obj.value)return new Response('not found',{status:404,headers:CORS});
        const h=new Headers(CORS);
        h.set('Content-Type',(obj.metadata&&obj.metadata.contentType)||'image/jpeg');
        h.set('Cache-Control','public, max-age=31536000, immutable');
        return new Response(req.method==='HEAD'?null:obj.value,{headers:h});
      }catch(e){
        return new Response('error: '+e.message,{status:500,headers:CORS});
      }
    }

    // ----- Push relay: POST / -----
    if(req.method!=='POST')return new Response('nope',{status:405,headers:CORS});
    if(!authOK(req,env))return json({error:'forbidden'},{status:403});
    try{
      const {title,body,addedBy}=await req.json();
      // Body is omitted from the log to avoid retaining message contents.
      console.log('Sending push:',title);
      const r=await fetch(`${FB}/subscriptions.json?auth=${encodeURIComponent(env.FB_AUTH)}`);
      const subs=await r.json();
      console.log('Subscriptions found:',subs?Object.keys(subs).length:0);
      if(!subs)return json({sent:0});
      let sent=0,expired=[];
      await Promise.allSettled(Object.entries(subs).map(async([k,s])=>{
        // Self-exclusion: skip the subscription owned by whoever added the item.
        if(addedBy && s.member === addedBy) return;
        try{
          const st=await sendOne(s,title,body,env.VAPID_PRIV);
          if(st===410||st===404)expired.push(k);
          else if(st<300)sent++;
        }catch(e){console.log('Error:',k,e.message);}
      }));
      await Promise.all(expired.map(k=>fetch(`${FB}/subscriptions/${k}.json?auth=${encodeURIComponent(env.FB_AUTH)}`,{method:'DELETE'})));
      console.log('Done. Sent:',sent,'Expired:',expired.length);
      return json({sent,expired:expired.length});
    }catch(e){
      console.log('Fatal:',e.message);
      return json({error:e.message},{status:500});
    }
  }
};
