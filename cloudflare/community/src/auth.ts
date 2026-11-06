import {neon} from '@neondatabase/serverless';
import type {Env,Identity} from './env';
import {equalSecret} from './telegram/permissions';

function cookies(header:string):Map<string,string>{
  const result=new Map<string,string>();
  for(const item of header.split(';')) {const i=item.indexOf('=');if(i<0)continue;const key=item.slice(0,i).trim();if(result.has(key))throw new Error('ambiguous cookie');result.set(key,item.slice(i+1).trim());}
  return result;
}
export const DEFAULT_ALLOWED_ORIGINS = new Set([
  'https://www.phephim.ai',
  'https://phephim.ai',
  'https://phephim.vercel.app',
]);

export function isAllowedOrigin(originHeader: string | null | undefined, env: Env): boolean {
  if (!originHeader) return false;
  const origin = originHeader.trim().toLowerCase().replace(/\/+$/, '');
  if (DEFAULT_ALLOWED_ORIGINS.has(origin)) return true;
  if (env.APP_ORIGIN && origin === env.APP_ORIGIN.trim().toLowerCase().replace(/\/+$/, '')) return true;
  if (env.ALLOWED_ORIGINS) {
    for (const item of env.ALLOWED_ORIGINS.split(',')) {
      if (origin === item.trim().toLowerCase().replace(/\/+$/, '')) return true;
    }
  }
  try {
    const url = new URL(origin);
    if (url.protocol === 'https:') {
      const host = url.hostname.toLowerCase();
      if (host === 'phephim.ai' || host.endsWith('.phephim.ai')) return true;
      if (host === 'phephim.vercel.app' || (host.startsWith('phephim-') && host.endsWith('.vercel.app'))) return true;
    } else if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function extractOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (origin) return origin;
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const u = new URL(referer);
      return `${u.protocol}//${u.host}`;
    } catch {
      return null;
    }
  }
  return null;
}

export async function sha256(value:string):Promise<string>{
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(buf),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function authenticate(request:Request,env:Env,csrf=false):Promise<Identity|null>{
  let jar:Map<string,string>;try{jar=cookies(request.headers.get('cookie')||'')}catch{return null}
  const token=jar.get('__Host-phe_session');if(!token||token.length>128)return null;
  if(csrf && !isAllowedOrigin(extractOrigin(request), env)) return null;
  const hash=await sha256(token);const sql=neon(env.DATABASE_URL);
  const rows=await sql.query(`SELECT u.id,u.username,encode(s.csrf_token_hash,'hex') csrf_hash FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=decode($1,'hex') AND s.revoked_at IS NULL AND s.expires_at>now()`,[hash]);
  if(rows.length!==1)return null;
  if(csrf){const header=request.headers.get('x-csrf-token')||'';const cookie=jar.get('__Host-phe_csrf')||'';if(!header||header.length>128||!equalSecret(header,cookie)||!equalSecret(await sha256(header),String(rows[0].csrf_hash)))return null;}
  return {id:Number(rows[0].id),username:String(rows[0].username),sessionHash:hash};
}
