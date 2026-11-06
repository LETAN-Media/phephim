import {Hono} from 'hono';
import {neon} from '@neondatabase/serverless';
import {authenticate, isAllowedOrigin} from './auth';
import {readBodyLimited} from './body';
import {supportAccess,supportStaff} from './support-access';
import type {Env,Identity} from './env';
const support=new Hono<{Bindings:Env}>();
const id=(value:string)=>/^[1-9]\d{0,14}$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
function internal(request:Request,user:Identity,conversation:number,path:string,body?:string):Request{
 const headers=new Headers(request.headers);headers.delete('cookie');
 for(const key of [...headers.keys()])if(key.toLowerCase().startsWith('x-internal-'))headers.delete(key);
 headers.set('x-internal-user',String(user.id));headers.set('x-internal-name',user.username);headers.set('x-internal-session',user.sessionHash);headers.set('x-internal-conversation',String(conversation));
 return new Request('https://internal.invalid'+path,{method:request.method,headers,body});
}
support.post('/api/support/conversation',async c=>{
 const user=await authenticate(c.req.raw,c.env,true);if(!user)return c.json({detail:'Vui lòng đăng nhập.'},403);
 const rows=await neon(c.env.DATABASE_URL).query('SELECT community_support_open($1) AS id',[user.id]);return c.json({id:Number(rows[0].id)});
});
support.get('/api/support/conversations',async c=>{
 const user=await authenticate(c.req.raw,c.env);if(!user||!await supportStaff(c.env,user))return c.json({detail:'Không có quyền truy cập.'},403);
 const rows=await neon(c.env.DATABASE_URL).query(`SELECT c.id,u.username,c.status,c.updated_at,(c.last_user_message_at IS NOT NULL AND (c.last_staff_message_at IS NULL OR c.last_staff_message_at<c.last_user_message_at)) AS needs_reply FROM community_support_conversations c JOIN users u ON u.id=c.owner_id ORDER BY c.updated_at DESC LIMIT 100`);
 return c.json({conversations:rows.map(r=>({...r,id:Number(r.id)}))});
});
support.get('/api/support/conversations/:id/messages',async c=>{
 const conversation=id(c.req.param('id'));const user=await authenticate(c.req.raw,c.env);if(!conversation||!user||!await supportAccess(c.env,user,conversation))return c.json({detail:'Không tìm thấy hội thoại.'},404);
 const raw=c.req.query('before');const before=raw?id(raw):null;if(raw&&!before)return c.json({detail:'Yêu cầu không hợp lệ.'},400);
 const rows=await neon(c.env.DATABASE_URL).query(`SELECT m.id,m.conversation_id,m.author_id AS user_id,m.body,m.is_bot,m.created_at,u.username FROM community_support_messages m LEFT JOIN users u ON u.id=m.author_id WHERE m.conversation_id=$1 AND ($2::bigint IS NULL OR m.id<$2) ORDER BY m.id DESC LIMIT 30`,[conversation,before]);
 return c.json({messages:rows.reverse().map(r=>({...r,id:Number(r.id),user_id:r.user_id===null?null:Number(r.user_id)}))});
});
support.post('/api/support/conversations/:id/messages',async c=>{
 const conversation=id(c.req.param('id'));const user=await authenticate(c.req.raw,c.env,true);if(!conversation||!user||!await supportAccess(c.env,user,conversation))return c.json({detail:'Không tìm thấy hội thoại.'},404);
 const body=await readBodyLimited(c.req.raw,4096);if(body===null)return c.json({detail:'Tin nhắn quá dài.'},413);
 const stub=c.env.SUPPORT_ROOMS.get(c.env.SUPPORT_ROOMS.idFromName(`support:${conversation}`));const response=await stub.fetch(internal(c.req.raw,user,conversation,'/send',body));const result=await response.json() as Record<string,unknown>;
 if(result.error==='rate')return c.json({detail:'Bạn gửi quá nhanh. Vui lòng thử lại sau.'},429);
 if(result.error==='banned')return c.json({detail:'Quyền gửi tin nhắn đang bị tạm khóa.'},403);
 if(result.error)return c.json({detail:'Không thể gửi tin nhắn.'},400);return c.json(result);
});
support.patch('/api/support/conversations/:id/status',async c=>{
 const conversation=id(c.req.param('id'));const user=await authenticate(c.req.raw,c.env,true);if(!conversation||!user||!await supportStaff(c.env,user))return c.json({detail:'Không có quyền truy cập.'},403);
 const raw=await readBodyLimited(c.req.raw,1024);if(raw===null)return c.json({detail:'Yêu cầu không hợp lệ.'},400);let payload:{status?:unknown};try{payload=JSON.parse(raw)}catch{return c.json({detail:'Yêu cầu không hợp lệ.'},400)}
 const status=payload.status;if(status!=='open'&&status!=='in_progress'&&status!=='resolved')return c.json({detail:'Trạng thái không hợp lệ.'},400);
 const rows=await neon(c.env.DATABASE_URL).query(`WITH changed AS (UPDATE community_support_conversations SET status=$2,updated_at=now() WHERE id=$1 RETURNING id), audit AS (INSERT INTO community_support_audit(conversation_id,actor_id,action) SELECT id,$3,$2 FROM changed) SELECT id FROM changed`,[conversation,status,user.id]);
 if(!rows.length)return c.json({detail:'Không tìm thấy hội thoại.'},404);return c.json({ok:true});
});
support.get('/ws/support/:id',async c=>{
 const conversation=id(c.req.param('id'));if(!conversation||!isAllowedOrigin(c.req.header('Origin'), c.env))return c.text('Forbidden',403);
 const user=await authenticate(c.req.raw,c.env);if(!user||!await supportAccess(c.env,user,conversation))return c.text('Not found',404);
 const stub=c.env.SUPPORT_ROOMS.get(c.env.SUPPORT_ROOMS.idFromName(`support:${conversation}`));return stub.fetch(internal(c.req.raw,user,conversation,'/connect'));
});
export default support;
