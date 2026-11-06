import {Hono} from 'hono';
import {neon} from '@neondatabase/serverless';
import {authenticate, extractOrigin, isAllowedOrigin} from './auth';
import type {Env,Identity} from './env';
import telegram from './telegram/webhook';
import admin from './admin';
import support from './support';
import {runJobs} from './jobs';
import {readBodyLimited} from './body';
export {ChatRoom} from './room';
export {SupportRoom} from './support-room';

const app=new Hono<{Bindings:Env}>();
app.route('/',telegram);
app.route('/',admin);
app.route('/',support);
const normalizeIds=(row:Record<string,unknown>)=>({...row,id:Number(row.id),...(row.room_id!==undefined?{room_id:Number(row.room_id)}:{}),...(row.user_id!==undefined?{user_id:row.user_id===null?null:Number(row.user_id)}:{})});
const roomId=(s:string)=>/^[1-9]\d{0,14}$/.test(s)&&Number.isSafeInteger(Number(s))?Number(s):null;
async function publicRoom(env:Env,id:number){const sql=neon(env.DATABASE_URL);return (await sql.query('SELECT id,name,slug FROM community_rooms WHERE id=$1 AND enabled AND public_read',[id]))[0]||null}
function internal(req:Request,identity:Identity,room:number,path:string):Request{
 const headers=new Headers(req.headers);headers.delete('cookie');
 for(const key of [...headers.keys()])if(key.toLowerCase().startsWith('x-internal-'))headers.delete(key);
 headers.set('x-internal-user',String(identity.id));headers.set('x-internal-name',identity.username);headers.set('x-internal-room',String(room));headers.set('x-internal-session',identity.sessionHash);
 return new Request('https://internal.invalid'+path,{method:req.method,headers,body:req.method==='GET'?undefined:req.body});
}
app.get('/api/community/rooms',async c=>{const sql=neon(c.env.DATABASE_URL);return c.json({rooms:(await sql.query('SELECT id,slug,name FROM community_rooms WHERE enabled AND public_read ORDER BY id')).map(normalizeIds)})});
app.get('/api/community/rooms/:id/messages',async c=>{
 const id=roomId(c.req.param('id'));if(!id||!await publicRoom(c.env,id))return c.json({detail:'Không tìm thấy phòng.'},404);
 const raw=c.req.query('before');const before=raw?roomId(raw):null;if(raw&&!before)return c.json({detail:'Yêu cầu không hợp lệ.'},400);
 const sql=neon(c.env.DATABASE_URL);
 const user=await authenticate(c.req.raw,c.env);
 if(user&&!before){
  try{await sql.query('SELECT community_worker_welcome($1,$2)',[id,user.id]);}catch{}
 }
 const rows=await sql.query(`SELECT m.id,m.room_id,m.body,m.created_at,m.user_id,m.is_bot,u.username FROM community_messages m LEFT JOIN users u ON u.id=m.user_id WHERE m.room_id=$1 AND m.deleted_at IS NULL AND ($2::bigint IS NULL OR m.id<$2) AND NOT EXISTS(SELECT 1 FROM community_pins p WHERE p.message_id=m.id) ORDER BY m.id DESC LIMIT 30`,[id,before]);return c.json({messages:rows.reverse().map(normalizeIds)});
});
app.get('/api/community/rooms/:id/pins',async c=>{
 const id=roomId(c.req.param('id'));if(!id||!await publicRoom(c.env,id))return c.json({detail:'Không tìm thấy phòng.'},404);
 const sql=neon(c.env.DATABASE_URL);return c.json({pins:(await sql.query('SELECT m.id,m.body,m.is_bot,m.created_at FROM community_pins p JOIN community_messages m ON m.id=p.message_id WHERE p.room_id=$1 AND m.deleted_at IS NULL ORDER BY p.pinned_at DESC LIMIT 50',[id])).map(normalizeIds)});
});
app.post('/api/community/rooms/:id/messages',async c=>{
 const id=roomId(c.req.param('id'));if(!id||!await publicRoom(c.env,id))return c.json({detail:'Không tìm thấy phòng.'},404);
 const user=await authenticate(c.req.raw,c.env,true);if(!user)return c.json({detail:'Vui lòng đăng nhập và thử lại.'},403);
 const body=await readBodyLimited(c.req.raw,4096);if(body===null)return c.json({detail:'Tin nhắn quá dài.'},413);
 const stub=c.env.CHAT_ROOMS.get(c.env.CHAT_ROOMS.idFromName(`room:${id}`));const request=new Request(c.req.url,{method:'POST',headers:c.req.raw.headers,body});const response=await stub.fetch(internal(request,user,id,'/send'));const result=await response.json() as Record<string,unknown>;
 if(result.error==='duplicate')return c.json({detail:'Tin nhắn trùng gần đây. Vui lòng tránh gửi lại.'},429);
 if(result.error==='rate')return c.json({detail:'Bạn gửi quá nhanh. Vui lòng thử lại sau.'},429);
 if(result.error)return c.json({detail:'Không thể gửi tin nhắn.'},400);
 return c.json(result);
});
app.delete('/api/community/messages/:id',async c=>{
 const mid=roomId(c.req.param('id'));if(!mid)return c.json({detail:'Không tìm thấy tin nhắn.'},404);
 const user=await authenticate(c.req.raw,c.env,true);if(!user)return c.json({detail:'Vui lòng đăng nhập.'},403);
 const sql=neon(c.env.DATABASE_URL);const rows=await sql.query(`WITH changed AS (UPDATE community_messages SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL AND (user_id=$2 OR EXISTS(SELECT 1 FROM community_roles WHERE user_id=$2 AND role IN ('admin','moderator'))) RETURNING id,room_id,user_id), audit AS (INSERT INTO community_moderation_actions(actor_id,action,room_id,message_id) SELECT $2,'delete',room_id,id FROM changed WHERE user_id IS DISTINCT FROM $2 RETURNING id) SELECT room_id FROM changed`,[mid,user.id]);
 if(!rows.length)return c.json({detail:'Không thể xóa tin nhắn.'},403);
 const room=Number(rows[0].room_id);const stub=c.env.CHAT_ROOMS.get(c.env.CHAT_ROOMS.idFromName(`room:${room}`));
 const msg=new Request(c.req.url,{method:'POST',headers:c.req.raw.headers,body:JSON.stringify({id:mid})});await stub.fetch(internal(msg,user,room,'/invalidate'));
 return c.json({ok:true});
});
app.post('/api/community/messages/:id/report',async c=>{
 const mid=roomId(c.req.param('id'));if(!mid)return c.json({detail:'Không tìm thấy tin nhắn.'},404);
 const user=await authenticate(c.req.raw,c.env,true);if(!user)return c.json({detail:'Vui lòng đăng nhập.'},403);
 const raw=await readBodyLimited(c.req.raw,2048);if(raw===null)return c.json({detail:'Yêu cầu quá lớn.'},413);let data:{reason?:unknown};try{data=JSON.parse(raw)}catch{return c.json({detail:'Yêu cầu không hợp lệ.'},400)}
 const reason=typeof data.reason==='string'?data.reason.trim():'';if(!reason||reason.length>500)return c.json({detail:'Lý do không hợp lệ.'},400);
 const sql=neon(c.env.DATABASE_URL);const rows=await sql.query(`INSERT INTO community_reports(message_id,reporter_id,reason) SELECT id,$2,$3 FROM community_messages WHERE id=$1 AND deleted_at IS NULL ON CONFLICT(message_id,reporter_id) DO NOTHING RETURNING id`,[mid,user.id,reason]);
 return c.json({ok:true});
});
app.post('/api/community/violations/:id/appeal',async c=>{
 const violation=roomId(c.req.param('id'));if(!violation)return c.json({detail:'Không tìm thấy cảnh báo.'},404);
 const user=await authenticate(c.req.raw,c.env,true);if(!user)return c.json({detail:'Vui lòng đăng nhập.'},403);
 const sql=neon(c.env.DATABASE_URL);const rows=await sql.query("UPDATE community_violations SET appeal_status='pending' WHERE id=$1 AND user_id=$2 AND appeal_status='none' AND voided_at IS NULL RETURNING id",[violation,user.id]);
 if(!rows.length)return c.json({detail:'Không thể gửi kháng nghị.'},404);return c.json({ok:true});
});
app.get('/ws/community/:id',async c=>{
 const id=roomId(c.req.param('id'));if(!id||!await publicRoom(c.env,id))return c.text('Not found',404);
 if(!isAllowedOrigin(extractOrigin(c.req.raw) || c.req.header('Origin'), c.env))return c.text('Forbidden',403);
 const user=await authenticate(c.req.raw,c.env);if(!user)return c.text('Unauthorized',401);
 const stub=c.env.CHAT_ROOMS.get(c.env.CHAT_ROOMS.idFromName(`room:${id}`));return stub.fetch(internal(c.req.raw,user,id,'/connect'));
});
app.get('/cong-dong/',c=>c.env.ASSETS.fetch(new Request(new URL('/index.html',c.req.url),c.req.raw)));
app.get('/cong-dong/static/*',c=>{const url=new URL(c.req.url);url.pathname=url.pathname.replace(/^\/cong-dong/,'');return c.env.ASSETS.fetch(new Request(url,c.req.raw))});
app.onError(()=>new Response('Không thể xử lý yêu cầu.',{status:500,headers:{'Cache-Control':'no-store'}}));
export default {fetch:app.fetch,scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(runJobs(env));}};
