const encoder=new TextEncoder();
const decoder=new TextDecoder();
const bytesToBase64=bytes=>{let binary='';for(const byte of new Uint8Array(bytes))binary+=String.fromCharCode(byte);return btoa(binary);};
const base64ToBytes=value=>{const binary=atob(String(value||''));return Uint8Array.from(binary,ch=>ch.charCodeAt(0));};
const hex=bytes=>[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');

async function aesKey(secret){
  if(!secret||String(secret).length<32)throw Object.assign(new Error('INTEGRATION_ENCRYPTION_KEY must be configured with at least 32 characters'),{status:503});
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(String(secret)));
  return crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['encrypt','decrypt']);
}

export async function encryptSecret(secret,value){
  if(value===null||value===undefined||String(value)==='')return{ciphertext:null,iv:null};
  const key=await aesKey(secret),iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(String(value)));
  return{ciphertext:bytesToBase64(encrypted),iv:bytesToBase64(iv)};
}

export async function decryptSecret(secret,ciphertext,iv){
  if(!ciphertext||!iv)return'';
  const key=await aesKey(secret);
  const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(iv)},key,base64ToBytes(ciphertext));
  return decoder.decode(decrypted);
}

export async function sha256(value){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(String(value||''))));}

export async function hmacSha256(secret,value){
  const key=await crypto.subtle.importKey('raw',encoder.encode(String(secret||'')),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(String(value||''))));
}

export function randomToken(prefix=''){const raw=`${crypto.randomUUID().replaceAll('-','')}${crypto.randomUUID().replaceAll('-','')}`;return prefix?`${prefix}_${raw}`:raw;}
