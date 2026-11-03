import {Hono} from 'hono';
import {neon} from '@neondatabase/serverless';
import {authenticate} from './auth';
import {readBodyLimited} from './body';
import type {Env,Identity} from './env';
import {getCatalog} from './catalog';
import {containsSensitive} from './sensitive';

type Vars={actor:Identity;role:string};
const admin=new Hono<{Bindings:Env;Variables:Vars}>().basePath('/api/community/admin');
const id=(s:string)=>/^[1-9]\d{0,14}$/.test(s)&&Number.isSafeInteger(Number(s))?Number(s):null;
async function input(req:Request):Promise<Record<string,unknown>|null>{const text=await readBodyLimited(req,8192);if(text===null)return null;try{const data=JSON.parse(text);return data&&typeof data==='object'&&!Array.isArray(data)?data:null}catch{return null}}
admin.use('*',async(c,next)=>{
 const actor=await authenticate(c.req.raw,c.env,c.req.method!=='GET');if(!actor)return c.json({detail:'Vui lòng đăng nhập.'},403);
 const sql=neon(c.env.DATABASE_URL);const rows=await sql.query('SELECT role FROM community_roles WHERE user_id=$1',[actor.id]);const role=String(rows[0]?.role||'');
 if(role!=='admin'&&role!=='moderator')return c.json({detail:'Bạn không có quyền thực hiện.'},403);
 const path=new URL(c.req.url).pathname;
 const moderatorRead=c.req.method==='GET'&&['/api/community/admin/violations','/api/community/admin/bans','/api/community/admin/reports','/api/community/admin/moderation/stats'].includes(path);
 const moderatorWrite=(c.req.method==='POST'&&/^\/api\/community\/admin\/reports\/\d+\/resolve$/.test(path))||(c.req.method==='PUT'&&/^\/api\/community\/admin\/rooms\/\d+\/members\/\d+\/mute$/.test(path));
 if(role!=='admin'&&!moderatorRead&&!moderatorWrite)return c.json({detail:'Bạn không có quyền thực hiện.'},403);
 c.set('actor',actor);c.set('role',role);await next();
});
admin.get('/violations',async c=>{const sql=neon(c.env.DATABASE_URL);return c.json({violations:await sql.query('SELECT id,user_id,room_id,reason,warning_number,banned_until,created_at,voided_at,appeal_status,body FROM community_violations ORDER BY id DESC LIMIT 100')})});
admin.get('/bans',async c=>{const sql=neon(c.env.DATABASE_URL);return c.json({bans:await sql.query('SELECT user_id,warning_count,banned_until FROM community_warning_state WHERE banned_until>now() ORDER BY banned_until')})});
admin.get('/reports',async c=>{const sql=neon(c.env.DATABASE_URL);return c.json({reports:await sql.query('SELECT id,message_id,reporter_id,reason,created_at,resolved_at FROM community_reports ORDER BY id DESC LIMIT 100')})});
admin.get('/moderation/stats',async c=>{const sql=neon(c.env.DATABASE_URL);const rows=await sql.query("SELECT (SELECT count(*) FROM community_violations WHERE voided_at IS NULL) violations,(SELECT count(*) FROM community_warning_state WHERE banned_until>now()) active_bans,(SELECT count(*) FROM community_reports WHERE resolved_at IS NULL) open_reports");return c.json(rows[0])});
admin.get('/word-rules',async c=>{const sql=neon(c.env.DATABASE_URL);return c.json({rules:await sql.query('SELECT id,phrase,enabled FROM community_word_rules ORDER BY id')})});
admin.post('/word-rules',async c=>{
 const data=await input(c.req.raw);const phrase=typeof data?.phrase==='string'?data.phrase.trim():'';if(phrase.length<2||phrase.length>100||typeof data?.enabled!=='boolean')return c.json({detail:'Dữ liệu không hợp lệ.'},400);
 const sql=neon(c.env.DATABASE_URL);const result=await sql.query(`WITH rule AS (INSERT INTO community_word_rules(phrase,enabled,updated_by) VALUES($1,$2,$3) ON CONFLICT(phrase) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by RETURNING id), audit AS (INSERT INTO community_moderation_actions(actor_id,action,details) SELECT $3,'word_rule',jsonb_build_object('rule_id',id) FROM rule) SELECT id FROM rule`,[phrase,data.enabled,c.var.actor.id]);return c.json({id:result[0]?.id});
});
admin.post('/users/:id/unban',async c=>{const target=id(c.req.param('id'));if(!target)return c.json({detail:'Không tìm thấy tài khoản.'},404);const sql=neon(c.env.DATABASE_URL);await sql.query('SELECT community_worker_unban($1,$2)',[c.var.actor.id,target]);return c.json({ok:true})});
admin.post('/violations/:id/void',async c=>{const target=id(c.req.param('id'));if(!target)return c.json({detail:'Không tìm thấy cảnh báo.'},404);const sql=neon(c.env.DATABASE_URL);const result=await sql.query('SELECT community_worker_void_warning($1,$2) ok',[c.var.actor.id,target]);if(!result[0]?.ok)return c.json({detail:'Không tìm thấy cảnh báo.'},404);return c.json({ok:true})});
admin.post('/rooms',async c=>{
 const data=await input(c.req.raw);const slug=typeof data?.slug==='string'?data.slug:'';const name=typeof data?.name==='string'?data.name.trim():'';if(!/^[a-z0-9-]{1,64}$/.test(slug)||!name||name.length>100)return c.json({detail:'Dữ liệu không hợp lệ.'},400);
 const sql=neon(c.env.DATABASE_URL);const result=await sql.query(`WITH room AS (INSERT INTO community_rooms(slug,name) VALUES($1,$2) ON CONFLICT(slug) DO NOTHING RETURNING id), audit AS (INSERT INTO community_moderation_actions(actor_id,action,room_id) SELECT $3,'create_room',id FROM room) SELECT id FROM room`,[slug,name,c.var.actor.id]);if(!result.length)return c.json({detail:'Phòng đã tồn tại.'},409);return c.json({id:result[0].id});
});
admin.put('/roles/:id',async c=>{
 const target=id(c.req.param('id'));const data=await input(c.req.raw);if(!target||target===c.var.actor.id||!data||(data.role!==null&&data.role!=='admin'&&data.role!=='moderator'))return c.json({detail:'Dữ liệu không hợp lệ.'},400);
 const sql=neon(c.env.DATABASE_URL);if(data.role===null){await sql.query(`WITH changed AS (DELETE FROM community_roles WHERE user_id=$1 RETURNING user_id) INSERT INTO community_moderation_actions(actor_id,action,target_user_id,details) SELECT $2,'role',user_id,jsonb_build_object('role',NULL::text) FROM changed`,[target,c.var.actor.id]);}else{await sql.query(`WITH changed AS (INSERT INTO community_roles(user_id,role,granted_by) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,granted_by=excluded.granted_by,granted_at=now() RETURNING user_id,role) INSERT INTO community_moderation_actions(actor_id,action,target_user_id,details) SELECT $3,'role',user_id,jsonb_build_object('role',role) FROM changed`,[target,data.role,c.var.actor.id]);}return c.json({ok:true});
});
admin.post('/schedules',async c=>{
 const data=await input(c.req.raw);const room=Number(data?.room_id);const body=typeof data?.body==='string'?data.body.trim():'';const when=typeof data?.next_at==='string'?data.next_at:'';const interval=data?.interval_seconds??null;
 if(!Number.isSafeInteger(room)||room<=0||!body||body.length>2000||containsSensitive(body)||!/(Z|[+-]\d\d:\d\d)$/i.test(when)||!Number.isFinite(Date.parse(when))||(interval!==null&&(!Number.isInteger(interval)||Number(interval)<3600||Number(interval)>31536000)))return c.json({detail:'Dữ liệu không hợp lệ.'},400);
 const sql=neon(c.env.DATABASE_URL);const rows=await sql.query(`WITH schedule AS (INSERT INTO bot_schedules(room_id,body,next_at,interval_seconds,pin,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,room_id), audit AS (INSERT INTO community_moderation_actions(actor_id,action,room_id,details) SELECT $6,'schedule',room_id,jsonb_build_object('schedule_id',id) FROM schedule) SELECT id FROM schedule`,[room,body,when,interval,data?.pin===true,c.var.actor.id]);return c.json({id:rows[0].id});
});
admin.put('/movies/:slug/release',async c=>{
 const slug=c.req.param('slug');const data=await input(c.req.raw);const when=typeof data?.release_at==='string'?data.release_at:'';const note=typeof data?.verification_note==='string'?data.verification_note.trim():'';
 if(!(await getCatalog(c.env)).some(m=>m.slug===slug))return c.json({detail:'Không tìm thấy phim.'},404);
 if(!/(Z|[+-]\d\d:\d\d)$/i.test(when)||!Number.isFinite(Date.parse(when))||!note||note.length>500)return c.json({detail:'Dữ liệu không hợp lệ.'},400);
 const sql=neon(c.env.DATABASE_URL);await sql.query('SELECT community_worker_set_release($1,$2,$3,$4)',[c.var.actor.id,slug,when,note]);return c.json({ok:true});
});
admin.post('/rooms/:id/announcements',async c=>{
 const room=id(c.req.param('id'));const data=await input(c.req.raw);const body=typeof data?.body==='string'?data.body.trim():'';const requestId=typeof data?.request_id==='string'?data.request_id:'';
 if(!room||!body||body.length>2000||containsSensitive(body)||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))return c.json({detail:'Dữ liệu không hợp lệ.'},400);
 const sql=neon(c.env.DATABASE_URL);const rows=await sql.query('SELECT community_worker_admin_announce($1,$2,$3,$4,$5,$6,$7) AS result',[c.var.actor.id,room,requestId,body,data?.pin===true,c.env.TELEGRAM_CHANNEL_ID||'',c.env.TELEGRAM_CHANNEL_SYNC_ENABLED==='true']);
 const result=rows[0]?.result as Record<string,unknown>;if(result?.error)return c.json({detail:'Yêu cầu không hợp lệ.'},409);
 if(result?.created){const stub=c.env.CHAT_ROOMS.get(c.env.CHAT_ROOMS.idFromName(`room:${room}`));c.executionCtx.waitUntil(stub.fetch(new Request('https://internal.invalid/refresh',{method:'POST'})));}return c.json(result);
});
admin.post('/reports/:id/resolve',async c=>{
 const report=id(c.req.param('id'));if(!report)return c.json({detail:'Không tìm thấy báo cáo.'},404);const sql=neon(c.env.DATABASE_URL);
 const rows=await sql.query(`WITH changed AS (UPDATE community_reports SET resolved_at=now() WHERE id=$1 AND resolved_at IS NULL RETURNING message_id,id), audit AS (INSERT INTO community_moderation_actions(actor_id,action,message_id,details) SELECT $2,'resolve_report',message_id,jsonb_build_object('report_id',id) FROM changed) SELECT id FROM changed`,[report,c.var.actor.id]);
 if(!rows.length)return c.json({detail:'Không tìm thấy báo cáo.'},404);return c.json({ok:true});
});
admin.put('/rooms/:id/members/:user/mute',async c=>{
 const room=id(c.req.param('id')),user=id(c.req.param('user'));const data=await input(c.req.raw);const until=data?.until;
 if(!room||!user||!data||(until!==null&&(typeof until!=='string'||!/(Z|[+-]\d\d:\d\d)$/i.test(until)||!Number.isFinite(Date.parse(until)))))return c.json({detail:'Dữ liệu không hợp lệ.'},400);
 const sql=neon(c.env.DATABASE_URL);await sql.query(`WITH changed AS (INSERT INTO community_members(room_id,user_id,muted_until) VALUES($1,$2,$3) ON CONFLICT(room_id,user_id) DO UPDATE SET muted_until=excluded.muted_until RETURNING room_id,user_id) INSERT INTO community_moderation_actions(actor_id,action,room_id,target_user_id) SELECT $4,'mute',room_id,user_id FROM changed`,[room,user,until,c.var.actor.id]);return c.json({ok:true});
});
admin.post('/pins/:id',async c=>{
 const message=id(c.req.param('id'));if(!message)return c.json({detail:'Không tìm thấy thông báo.'},404);const sql=neon(c.env.DATABASE_URL);
 const rows=await sql.query(`WITH pin AS (INSERT INTO community_pins(room_id,message_id,pinned_by) SELECT room_id,id,$2 FROM community_messages WHERE id=$1 AND is_bot AND deleted_at IS NULL ON CONFLICT(message_id) DO NOTHING RETURNING room_id,message_id), audit AS (INSERT INTO community_moderation_actions(actor_id,action,room_id,message_id) SELECT $2,'pin',room_id,message_id FROM pin) SELECT room_id FROM pin`,[message,c.var.actor.id]);
 if(rows[0]){const stub=c.env.CHAT_ROOMS.get(c.env.CHAT_ROOMS.idFromName(`room:${rows[0].room_id}`));c.executionCtx.waitUntil(stub.fetch(new Request('https://internal.invalid/refresh',{method:'POST'})));}return c.json({ok:true});
});
admin.delete('/pins/:id',async c=>{
 const message=id(c.req.param('id'));if(!message)return c.json({detail:'Không tìm thấy thông báo.'},404);const sql=neon(c.env.DATABASE_URL);
 const rows=await sql.query(`WITH pin AS (DELETE FROM community_pins WHERE message_id=$1 RETURNING room_id,message_id), audit AS (INSERT INTO community_moderation_actions(actor_id,action,room_id,message_id) SELECT $2,'unpin',room_id,message_id FROM pin) SELECT room_id FROM pin`,[message,c.var.actor.id]);
 if(!rows.length)return c.json({detail:'Không tìm thấy thông báo.'},404);const stub=c.env.CHAT_ROOMS.get(c.env.CHAT_ROOMS.idFromName(`room:${rows[0].room_id}`));c.executionCtx.waitUntil(stub.fetch(new Request('https://internal.invalid/refresh',{method:'POST'})));return c.json({ok:true});
});
admin.patch('/schedules/:id/enabled',async c=>{
 const schedule=id(c.req.param('id'));const data=await input(c.req.raw);if(!schedule||typeof data?.enabled!=='boolean')return c.json({detail:'Dữ liệu không hợp lệ.'},400);
 const sql=neon(c.env.DATABASE_URL);const rows=await sql.query(`WITH changed AS (UPDATE bot_schedules SET enabled=$2 WHERE id=$1 RETURNING id,room_id), audit AS (INSERT INTO community_moderation_actions(actor_id,action,room_id,details) SELECT $3,'schedule_toggle',room_id,jsonb_build_object('schedule_id',id,'enabled',$2::boolean) FROM changed) SELECT id FROM changed`,[schedule,data.enabled,c.var.actor.id]);if(!rows.length)return c.json({detail:'Không tìm thấy lịch thông báo.'},404);return c.json({ok:true});
});
admin.patch('/rooms/:id/enabled',async c=>{
 const room=id(c.req.param('id'));const data=await input(c.req.raw);if(!room||typeof data?.enabled!=='boolean')return c.json({detail:'Dữ liệu không hợp lệ.'},400);
 const sql=neon(c.env.DATABASE_URL);const rows=await sql.query(`WITH changed AS (UPDATE community_rooms SET enabled=$2 WHERE id=$1 RETURNING id), audit AS (INSERT INTO community_moderation_actions(actor_id,action,room_id,details) SELECT $3,'room_enabled',id,jsonb_build_object('enabled',$2::boolean) FROM changed) SELECT id FROM changed`,[room,data.enabled,c.var.actor.id]);if(!rows.length)return c.json({detail:'Không tìm thấy phòng.'},404);return c.json({ok:true});
});
admin.get('/moderation/settings',async c=>{const sql=neon(c.env.DATABASE_URL);const rows=await sql.query('SELECT anti_spam,anti_ads,block_solicitation,max_messages_10s,max_messages_60s,duplicate_window_seconds,max_warnings,ban_hours,message_retention_days FROM community_moderation_settings WHERE singleton=true');return c.json(rows[0]||{});});
admin.patch('/moderation/settings',async c=>{
 const data=await input(c.req.raw);if(!data)return c.json({detail:'Dữ liệu không hợp lệ.'},400);
 const booleans=['anti_spam','anti_ads','block_solicitation'];const limits:Record<string,[number,number]>={max_messages_10s:[1,50],max_messages_60s:[1,200],duplicate_window_seconds:[10,600],message_retention_days:[1,365]};
 const allowed=new Set([...booleans,...Object.keys(limits)]);if(!Object.keys(data).length||Object.keys(data).some(k=>!allowed.has(k)))return c.json({detail:'Dữ liệu không hợp lệ.'},400);
 if(booleans.some(k=>k in data&&typeof data[k]!=='boolean')||Object.entries(limits).some(([k,[lo,hi]])=>k in data&&(!Number.isInteger(data[k])||Number(data[k])<lo||Number(data[k])>hi)))return c.json({detail:'Dữ liệu không hợp lệ.'},400);
 const sql=neon(c.env.DATABASE_URL);const p=[data.anti_spam??null,data.anti_ads??null,data.block_solicitation??null,data.max_messages_10s??null,data.max_messages_60s??null,data.duplicate_window_seconds??null,data.message_retention_days??null,c.var.actor.id];
 await sql.query(`WITH changed AS (UPDATE community_moderation_settings SET anti_spam=coalesce($1::boolean,anti_spam),anti_ads=coalesce($2::boolean,anti_ads),block_solicitation=coalesce($3::boolean,block_solicitation),max_messages_10s=coalesce($4::integer,max_messages_10s),max_messages_60s=coalesce($5::integer,max_messages_60s),duplicate_window_seconds=coalesce($6::integer,duplicate_window_seconds),message_retention_days=coalesce($7::integer,message_retention_days),updated_by=$8,updated_at=now() WHERE singleton=true RETURNING singleton), audit AS (INSERT INTO community_moderation_actions(actor_id,action) SELECT $8,'moderation_settings' FROM changed) SELECT singleton FROM changed`,p);return c.json({ok:true});
});
admin.get('/advertising-rules',async c=>{const sql=neon(c.env.DATABASE_URL);return c.json({rules:await sql.query('SELECT id,phrase,enabled FROM community_advertising_rules ORDER BY id')});});
admin.post('/advertising-rules',async c=>{
 const data=await input(c.req.raw);const phrase=typeof data?.phrase==='string'?data.phrase.trim():'';if(phrase.length<5||phrase.length>100||typeof data?.enabled!=='boolean'||containsSensitive(phrase))return c.json({detail:'Dữ liệu không hợp lệ.'},400);
 const sql=neon(c.env.DATABASE_URL);const rows=await sql.query(`WITH rule AS (INSERT INTO community_advertising_rules(phrase,enabled,updated_by) VALUES($1,$2,$3) ON CONFLICT(phrase) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by RETURNING id), audit AS (INSERT INTO community_moderation_actions(actor_id,action,details) SELECT $3,'advertising_rule',jsonb_build_object('rule_id',id) FROM rule) SELECT id FROM rule`,[phrase,data.enabled,c.var.actor.id]);return c.json({id:rows[0].id});
});
admin.post('/violations/:id/appeal',async c=>{
 const violation=id(c.req.param('id'));const data=await input(c.req.raw);if(!violation||!data||(data.action!=='voided'&&data.action!=='upheld'))return c.json({detail:'Dữ liệu không hợp lệ.'},400);const sql=neon(c.env.DATABASE_URL);
 if(data.action==='voided'){const rows=await sql.query('SELECT community_worker_void_warning($1,$2) ok',[c.var.actor.id,violation]);if(!rows[0]?.ok)return c.json({detail:'Không tìm thấy cảnh báo.'},404);return c.json({ok:true});}
 const rows=await sql.query(`WITH changed AS (UPDATE community_violations SET appeal_status='upheld',reviewed_by=$2 WHERE id=$1 AND appeal_status='pending' AND voided_at IS NULL RETURNING id,user_id),audit AS (INSERT INTO community_moderation_actions(actor_id,action,target_user_id,details) SELECT $2,'appeal_upheld',user_id,jsonb_build_object('violation_id',id) FROM changed) SELECT id FROM changed`,[violation,c.var.actor.id]);if(!rows.length)return c.json({detail:'Không tìm thấy kháng nghị.'},404);return c.json({ok:true});
});
export default admin;
