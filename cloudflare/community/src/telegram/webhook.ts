import {Hono} from 'hono';
import {neon} from '@neondatabase/serverless';
import type {Env} from '../env';
import {equalSecret,isAdmin} from './permissions';
import {sendTelegram} from './client';
import {getCatalog} from '../catalog';
import {readBodyLimited} from '../body';
import {safeConversationAnswer} from '../ai-response';
import {containsSensitive} from '../sensitive';

const app=new Hono<{Bindings:Env}>();
type Update={update_id?:unknown;message?:{text?:unknown;from?:{id?:unknown};chat?:{id?:unknown;type?:unknown}}};
const admins=new Set(['/announce','/publish','/schedule','/pin','/unpin','/movies','/status']);

app.post('/api/telegram/webhook',async c=>{
 if(!equalSecret(c.env.TELEGRAM_WEBHOOK_SECRET||'',c.req.header('X-Telegram-Bot-Api-Secret-Token')||''))return c.text('Forbidden',403);
 const input=await readBodyLimited(c.req.raw,32768);if(input===null)return c.text('Too large',413);
 let update:Update;try{update=JSON.parse(input)}catch{return c.text('Invalid',400)}
 if(!Number.isSafeInteger(update.update_id)||Number(update.update_id)<0)return c.text('Invalid',400);
 const message=update.message;const uid=message?.from?.id;if(typeof uid!=='number'||!Number.isSafeInteger(uid)||message?.chat?.type!=='private'||message.chat.id!==uid||typeof message.text!=='string'||message.text.length>4096)return c.json({ok:true});
 const sql=neon(c.env.DATABASE_URL);const claimed=await sql.query('INSERT INTO telegram_updates(update_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING update_id',[update.update_id]);if(!claimed.length)return c.json({ok:true});
 const [head,...rest]=message.text.trim().split(/\s+/);const name=head?.split('@')[0]?.toLowerCase()||'';const body=rest.join(' ').trim();
 let reply='';
 if(admins.has(name)&&!isAdmin(uid,c.env.TELEGRAM_ADMIN_IDS))reply='Bạn không có quyền sử dụng lệnh này.';
 else if(name==='/start'||name==='/help')reply='Chào bạn! Dùng /phimmoi để xem danh mục, /sapchieu để xem lịch đã xác nhận, /ask để trò chuyện, /subscribe hoặc /unsubscribe để quản lý thông báo.';
 else if(name==='/subscribe'){await sql.query('INSERT INTO telegram_subscribers(telegram_user_id,active) VALUES($1,true) ON CONFLICT(telegram_user_id) DO UPDATE SET active=true,subscribed_at=now()',[uid]);reply='Bạn đã đăng ký nhận thông báo.';}
 else if(name==='/unsubscribe'){await sql.query('UPDATE telegram_subscribers SET active=false WHERE telegram_user_id=$1',[uid]);reply='Bạn đã ngừng nhận thông báo.';}
 else if(name==='/phimmoi'||name==='/movies')reply='Phim trong danh mục: '+(await getCatalog(c.env)).slice(0,8).map(m=>m.title).join(', ');
 else if(name==='/sapchieu'){
  const rows=await sql.query('SELECT movie_slug,release_at FROM community_movie_releases WHERE release_at>now() ORDER BY release_at LIMIT 10');
  const movies=await getCatalog(c.env);const lines=rows.map(r=>{const m=movies.find(x=>x.slug===r.movie_slug);return m?`${m.title} · ${new Date(String(r.release_at)).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}`:null}).filter(Boolean);
  reply=lines.length?'Lịch đã xác nhận:\n'+lines.join('\n'):'Hiện chưa có lịch ra mắt được xác nhận.';
 }
 else if(name==='/status')reply='Hệ thống cộng đồng đang hoạt động.';
 else if(name==='/announce'){
  if(!body||body.length>2000||containsSensitive(body))reply='Dùng /announce kèm nội dung thông báo.';
  else {const rows=await sql.query(`WITH draft AS (INSERT INTO telegram_drafts(author_telegram_id,body,room_id) SELECT $1,$2,id FROM community_rooms WHERE slug='cong-dong-chung' AND enabled RETURNING id), audit AS (INSERT INTO telegram_admin_actions(actor_telegram_id,action,target_id) SELECT $1,'announce',id FROM draft) SELECT id FROM draft`,[uid,body]);reply=rows[0]?`Đã tạo bản nháp #${rows[0].id}. Dùng /publish ${rows[0].id} để xuất bản.`:'Không tìm thấy phòng cộng đồng.';}
 }
 else if(name==='/publish'){
  if(!/^\d{1,15}$/.test(body))reply='Dùng /publish kèm số bản nháp.';
  else {const rows=await sql.query('SELECT community_worker_telegram_publish($1,$2,$3) AS result',[Number(body),c.env.TELEGRAM_CHANNEL_ID||'',uid]);const result=rows[0]?.result as Record<string,unknown>;reply=result?.error?'Không tìm thấy bản nháp.':result?.already?'Bản nháp đã được xuất bản.':`Đã xuất bản thông báo #${result?.message_id}.`;if(result?.room_id&&!result.already){const room=c.env.CHAT_ROOMS.get(c.env.CHAT_ROOMS.idFromName(`room:${result.room_id}`));c.executionCtx.waitUntil(room.fetch(new Request('https://internal.invalid/refresh',{method:'POST'})));}}
 }
 else if(name==='/pin'||name==='/unpin'){
  if(!/^\d{1,15}$/.test(body))reply=`Dùng ${name} kèm số tin nhắn chính thức.`;
  else {const id=Number(body);const q=name==='/pin'?`INSERT INTO community_pins(room_id,message_id) SELECT room_id,id FROM community_messages WHERE id=$1 AND is_bot AND deleted_at IS NULL ON CONFLICT DO NOTHING RETURNING room_id`:`DELETE FROM community_pins WHERE message_id=$1 RETURNING room_id`;const changed=await sql.query(q,[id]);if(changed[0]){const room=c.env.CHAT_ROOMS.get(c.env.CHAT_ROOMS.idFromName(`room:${changed[0].room_id}`));c.executionCtx.waitUntil(room.fetch(new Request('https://internal.invalid/refresh',{method:'POST'})));}await sql.query('INSERT INTO telegram_admin_actions(actor_telegram_id,action,target_id) VALUES($1,$2,$3)',[uid,name.slice(1),id]);reply='Đã cập nhật thông báo ghim.';}
 }
 else if(name==='/schedule'){
  const [when,...parts]=rest;const content=parts.join(' ').trim();const date=when?new Date(when):null;
  if(!date||!Number.isFinite(date.getTime())||!/(Z|[+-]\d\d:\d\d)$/i.test(when)||!content||content.length>2000||containsSensitive(content))reply='Dùng /schedule THỜI_GIAN_ISO nội dung thông báo.';
  else {const rows=await sql.query(`INSERT INTO bot_schedules(room_id,body,next_at,pin,created_by_telegram_id) SELECT id,$1,$2,true,$3 FROM community_rooms WHERE slug='cong-dong-chung' AND enabled RETURNING id`,[content,date.toISOString(),uid]);reply=rows[0]?`Đã tạo lịch thông báo #${rows[0].id}.`:'Không tìm thấy phòng cộng đồng.';}
 }
 else if(name==='/ask'){
  if(containsSensitive(body))reply='Vui lòng không gửi thông tin đăng nhập hoặc mã bí mật.';
  else if(!body||body.length>1000)reply='Dùng /ask kèm câu hỏi ngắn.';
  else {
   const coordinator=c.env.CHAT_ROOMS.get(c.env.CHAT_ROOMS.idFromName('telegram:ai'));
   const res=await coordinator.fetch(new Request('https://internal.invalid/reserve-bot',{method:'POST',body:JSON.stringify({user:uid,source:Number(update.update_id),room:1})}));const quota=await res.json() as {allowed:boolean};
   if(!quota.allowed)reply='Bạn hãy đợi một chút trước khi đặt câu hỏi tiếp theo.';
   else try{
    const movies=await getCatalog(c.env);const prompt=body.replace(/[\w.+-]+@[\w.-]+/g,'[ẩn]');const input={messages:[{role:'system',content:'Bạn là Hưng Creater, trả lời ngắn bằng tiếng Việt. Chỉ khẳng định dữ liệu website khi có trong danh mục được cung cấp, không bịa lịch chiếu, số tập hay trạng thái. Không đưa URL bên ngoài.'},{role:'system',content:JSON.stringify(movies.map(({title,slug,genre})=>({title,slug,genre})))},{role:'user',content:prompt}],max_tokens:512};
    let result:Record<string,unknown>;try{result=await c.env.AI.run((c.env.CLOUDFLARE_WORKERS_AI_MODEL||'@cf/zai-org/glm-4.7-flash') as keyof AiModels,input as never) as unknown as Record<string,unknown>}catch{result=await c.env.AI.run((c.env.CLOUDFLARE_WORKERS_AI_FALLBACK||'@cf/qwen/qwen3-30b-a3b-fp8') as keyof AiModels,input as never) as unknown as Record<string,unknown>}
    const choices=result.choices as Array<{message?:{content?:string}}>|undefined;const answer=typeof result.response==='string'?result.response:choices?.[0]?.message?.content||'';
    reply=safeConversationAnswer(answer)||'Hiện chưa thể trả lời. Vui lòng thử lại sau.';
   }catch{reply='Hiện chưa thể trả lời. Vui lòng thử lại sau.'}
  }
 }
 if(reply&&c.env.TELEGRAM_BOT_TOKEN)await sendTelegram(c.env.TELEGRAM_BOT_TOKEN,uid,reply);
 return c.json({ok:true});
});
export default app;
