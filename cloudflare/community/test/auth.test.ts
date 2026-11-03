import {beforeEach,describe,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({rows:[] as Array<Record<string,unknown>>,calls:[] as unknown[]}));
vi.mock('@neondatabase/serverless',()=>({neon:()=>({query:async (_sql:string,params:unknown[])=>{fixture.calls.push(params);return fixture.rows}})}));
import {authenticate} from '../src/auth';
import type {Env} from '../src/env';
const env={DATABASE_URL:'postgresql://test:test@example.test/test',APP_ORIGIN:'https://phe.example'} as Env;
async function hash(s:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('')}
const request=(cookie:string,origin='https://phe.example',header='csrf-test')=>new Request('https://phe.example/api/community/rooms/1/messages',{method:'POST',headers:{cookie,origin,'x-csrf-token':header}});
describe('shared session security',()=>{
 beforeEach(async()=>{fixture.calls=[];fixture.rows=[{id:42,username:'viewer',csrf_hash:await hash('csrf-test')}]});
 it('uses a hash of the existing session and enforces matching CSRF',async()=>{
  const user=await authenticate(request('__Host-phe_session=session-test; __Host-phe_csrf=csrf-test'),env,true);
  expect(user?.id).toBe(42);expect(user?.sessionHash).toBe(await hash('session-test'));expect(JSON.stringify(fixture.calls)).not.toContain('session-test');
 });
 it('rejects foreign origin, missing CSRF and ambiguous session cookies',async()=>{
  const cookie='__Host-phe_session=session-test; __Host-phe_csrf=csrf-test';
  expect(await authenticate(request(cookie,'https://evil.example'),env,true)).toBeNull();
  expect(await authenticate(request(cookie,'https://phe.example','wrong'),env,true)).toBeNull();
  expect(await authenticate(request(cookie+'; __Host-phe_session=other'),env,true)).toBeNull();
 });
 it('rejects revoked or expired sessions',async()=>{fixture.rows=[];expect(await authenticate(request('__Host-phe_session=session-test'),env,false)).toBeNull()});
});
