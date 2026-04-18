const VAPID_PUB='BHeqNiEDdtZG2JXW-xhJxz8ARfkIPkyfgfQjt5rjf5a4I0nQJZYRqkPGXs-MnDkT6nc3W2lPH9IFlhGMzR4OJ-0';
const VAPID_PRIV='aILh5xJ8kd1_KRrZTI-rxKNy7CHF5sVExodNdokHe9c';
const VAPID_SUB='mailto:jivancheemalfc@gmail.com';
const FB='https://cheema-79800-default-rtdb.europe-west1.firebasedatabase.app';

function b64(buf){return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');}
function b64u(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}

async function jwt(aud){
  const h=b64(new TextEncoder().encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const p=b64(new TextEncoder().encode(JSON.stringify({aud,exp:Math.floor(Date.now()/1000)+43200,sub:VAPID_SUB})));
  const inp=`${h}.${p}`;
  const key=await crypto.subtle.importKey('raw',b64u(VAPID_PRIV),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(inp));
  return `${inp}.${b64(sig)}`;
}

async function hkdf(salt,ikm,info,len){
  const k=await crypto.subtle.importKey('raw',ikm,{name:'HKDF'},false,['deriveBits']);
  const prk=new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info:new Uint8Array(0)},k,256));
  const pk=await crypto.subtle.importKey('raw',prk,{name:'HKDF'},false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:new Uint8Array(0),info},pk,len*8));
}

async function encrypt(sub,title,body){
  const rPub=b64u(sub.keys.p256dh),auth=b64u(sub.keys.auth);
  const payload=new TextEncoder().encode(JSON.stringify({title,body,icon:'/icon.png',tag:'cfh'}));
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

async function push(sub,title,body){
  const ep=new URL(sub.endpoint);
  const token=await jwt(`${ep.protocol}//${ep.host}`);
  const enc=await encrypt(sub,title,body);
  const r=await fetch(sub.endpoint,{method:'POST',headers:{
    'Authorization':`vapid t=${token},k=${VAPID_PUB}`,
    'Content-Type':'application/octet-stream',
    'Content-Encoding':'aes128gcm','TTL':'86400'
  },body:enc});
  return r.status;
}

export default {
  async fetch(req){
    const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'};
    if(req.method==='OPTIONS')return new Response('',{headers:cors});
    if(req.method!=='POST')return new Response('',{status:405,headers:cors});
    try{
      const {title,body}=await req.json();
      const r=await fetch(`${FB}/subscriptions.json`);
      const subs=await r.json();
      if(!subs)return new Response(JSON.stringify({sent:0}),{headers:{...cors,'Content-Type':'application/json'}});
      let sent=0,expired=[];
      await Promise.allSettled(Object.entries(subs).map(async([k,s])=>{
        try{const st=await push(s,title,body);if(st===410||st===404)expired.push(k);else if(st<300)sent++;}catch(e){}
      }));
      await Promise.all(expired.map(k=>fetch(`${FB}/subscriptions/${k}.json`,{method:'DELETE'})));
      return new Response(JSON.stringify({sent}),{headers:{...cors,'Content-Type':'application/json'}});
    }catch(e){return new Response(JSON.stringify({error:e.message}),{status:500,headers:{...cors,'Content-Type':'application/json'}});}
  }
};
