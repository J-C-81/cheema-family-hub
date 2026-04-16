// Web Push — pure Node.js built-ins only, no npm packages
// Implements RFC 8291 aes128gcm encryption + VAPID JWT signing

const crypto = require('crypto');
const https  = require('https');
const { URL } = require('url');

const VAPID_SUB  = 'mailto:cheema@family.com';
const VAPID_PUB  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIV = process.env.VAPID_PRIVATE_KEY;
const FB_URL     = process.env.FIREBASE_URL;

function b64(buf){ return Buffer.from(buf).toString('base64url'); }

function hkdf(salt, ikm, info, len){
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  const i   = Buffer.isBuffer(info) ? info : Buffer.from(info);
  return crypto.createHmac('sha256', prk).update(Buffer.concat([i, Buffer.from([1])])).digest().slice(0, len);
}

function makeJWT(audience){
  const hdr = b64(JSON.stringify({typ:'JWT',alg:'ES256'}));
  const pay = b64(JSON.stringify({aud:audience, exp:Math.floor(Date.now()/1000)+43200, sub:VAPID_SUB}));
  const inp = `${hdr}.${pay}`;
  const pub = Buffer.from(VAPID_PUB,'base64url');
  const key = crypto.createPrivateKey({key:{kty:'EC',crv:'P-256',d:VAPID_PRIV,x:b64(pub.slice(1,33)),y:b64(pub.slice(33,65))},format:'jwk'});
  const sig = crypto.sign(null, Buffer.from(inp), {key, dsaEncoding:'ieee-p1363'});
  return `${inp}.${b64(sig)}`;
}

function encrypt(sub, payload){
  const rPub = Buffer.from(sub.keys.p256dh,'base64url');
  const auth = Buffer.from(sub.keys.auth,  'base64url');
  const plain= Buffer.from(typeof payload==='string'?payload:JSON.stringify(payload));
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const sPub   = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(rPub);
  const ikm    = hkdf(auth, secret, Buffer.concat([Buffer.from('WebPush: info\0'), rPub, sPub]), 32);
  const salt   = crypto.randomBytes(16);
  const cek    = hkdf(salt, ikm, 'Content-Encoding: aes128gcm\0', 16);
  const nonce  = hkdf(salt, ikm, 'Content-Encoding: nonce\0', 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct     = Buffer.concat([cipher.update(Buffer.concat([plain, Buffer.from([2])])), cipher.final()]);
  const tag    = cipher.getAuthTag();
  const rs     = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([sPub.length]), sPub, ct, tag]);
}

function sendOne(sub, body, jwt){
  return new Promise((res, rej) => {
    const ep  = new URL(sub.endpoint);
    const req = https.request({
      method:'POST', hostname:ep.hostname, path:ep.pathname+ep.search,
      headers:{
        Authorization:`vapid t=${jwt},k=${VAPID_PUB}`,
        'Content-Type':'application/octet-stream',
        'Content-Encoding':'aes128gcm',
        'Content-Length':body.length,
        TTL:'86400', Urgency:'normal'
      }
    }, r => {
      r.resume();
      r.on('end', ()=>{
        if(r.statusCode===410||r.statusCode===404) rej(new Error('expired'));
        else res(r.statusCode);
      });
    });
    req.on('error', rej); req.write(body); req.end();
  });
}

function httpsGet(url){
  return new Promise((res,rej)=>{
    https.get(url, r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));r.on('error',rej);}).on('error',rej);
  });
}

function httpsDelete(hostname, path){
  return new Promise(res=>{
    const r=https.request({method:'DELETE',hostname,path},x=>{x.resume();x.on('end',res);});
    r.on('error',res); r.end();
  });
}

exports.handler = async (event) => {
  const H={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'};
  if(event.httpMethod==='OPTIONS') return {statusCode:200,headers:H,body:''};
  if(event.httpMethod!=='POST')    return {statusCode:405,headers:H,body:'Method not allowed'};

  try {
    const {payload} = JSON.parse(event.body||'{}');
    const payStr = JSON.stringify(payload||{title:'Cheema Family Hub',body:'Something new!'});

    const raw  = await httpsGet(`${FB_URL}/subscriptions.json`);
    const subs = JSON.parse(raw);
    if(!subs||typeof subs!=='object') return {statusCode:200,headers:H,body:JSON.stringify({sent:0})};

    let sent=0, expired=[];
    await Promise.allSettled(Object.entries(subs).map(async([key,sub])=>{
      try{
        const ep  = new URL(sub.endpoint);
        const jwt = makeJWT(`${ep.protocol}//${ep.host}`);
        const enc = encrypt(sub, payStr);
        await sendOne(sub, enc, jwt);
        sent++;
      }catch(e){
        if(e.message==='expired') expired.push(key);
      }
    }));

    const fbHost = new URL(FB_URL).hostname;
    for(const k of expired) await httpsDelete(fbHost, `/subscriptions/${k}.json`);

    return {statusCode:200,headers:H,body:JSON.stringify({sent,expired:expired.length})};
  }catch(e){
    console.error(e);
    return {statusCode:500,headers:H,body:JSON.stringify({error:e.message})};
  }
};
