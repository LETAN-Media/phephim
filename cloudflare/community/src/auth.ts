import {neon} from '@neondatabase/serverless';
import type {Env,Identity} from './env';
import {equalSecret} from './telegram/permissions';

function cookies(header:string):Map<string,string>{
  const result=new Map<string,string>();
  for(const item of header.split(';')) {const i=item.indexOf('=');if(i<0)continue;const key=item.slice(0,i).trim();if(result.has(key))throw new Error('ambiguous cookie');result.set(key,item.slice(i+1).trim());}
  return result;
}
export async function sha256(value:string):Promise<string>{
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(buf),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function authenticate(request:Request,env:Env,csrf=false):Promise<Identity|null>{
  let jar:Map<string,string>;try{jar=cookies(request.headers.get('cookie')||'')}catch{return null}
  const token=jar.get('__Host-phe_session');if(!token||token.length>128)return null;
  if(csrf && request.headers.get('origin')!==env.APP_ORIGIN)return null;
  const hash=await sha256(token);const sql=neon(env.DATABASE_URL);
  const rows=await sql.query(`SELECT u.id,u.username,encode(s.csrf_token_hash,'hex') csrf_hash FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=decode($1,'hex') AND s.revoked_at IS NULL AND s.expires_at>now()`,[hash]);
  if(rows.length!==1)return null;
  if(csrf){const header=request.headers.get('x-csrf-token')||'';const cookie=jar.get('__Host-phe_csrf')||'';if(!header||header.length>128||!equalSecret(header,cookie)||!equalSecret(await sha256(header),String(rows[0].csrf_hash)))return null;}
  return {id:Number(rows[0].id),username:String(rows[0].username),sessionHash:hash};
}
