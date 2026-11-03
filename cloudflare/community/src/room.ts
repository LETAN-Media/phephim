import {DurableObject} from 'cloudflare:workers';
import {neon} from '@neondatabase/serverless';
import type {Env,Identity} from './env';
import {classifyWithContext,spamFingerprint} from './moderation';
import {effectivePolicy} from './moderation-policy';
import {isMovieQuestion,movieQuestion,probabilityAllowed} from './questions';
import {cooldownAllows} from './cooldown';
import {safeConversationAnswer,verifiedMovieFacts,composeVerifiedReply} from './ai-response';
import {containsSensitive} from './sensitive';
import {sha256} from './auth';
import {getCatalog} from './catalog';

type Attachment=Identity & {room:number};
type SqlRow=Record<string,unknown>;
export class ChatRoom extends DurableObject<Env>{
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS ai_attempts (source_id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,room_id INTEGER NOT NULL, created_ms INTEGER NOT NULL)');ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS request_flood (user_id INTEGER NOT NULL, client_id TEXT NOT NULL, created_ms INTEGER NOT NULL, PRIMARY KEY(user_id,client_id))');}
 private identity(req:Request):Attachment|null{
  const id=Number(req.headers.get('x-internal-user'));const room=Number(req.headers.get('x-internal-room'));const username=req.headers.get('x-internal-name')||'';const sessionHash=req.headers.get('x-internal-session')||'';
  if(!Number.isSafeInteger(id)||id<=0||!Number.isSafeInteger(room)||room<=0||!/^[a-f0-9]{64}$/.test(sessionHash))return null;
  return {id,room,username,sessionHash};
 }
 private async active(identity:Attachment):Promise<boolean>{
  const sql=neon(this.env.DATABASE_URL);const rows=await sql.query("SELECT 1 FROM user_sessions WHERE user_id=$1 AND token_hash=decode($2,'hex') AND revoked_at IS NULL AND expires_at>now()",[identity.id,identity.sessionHash]);return rows.length===1;
 }
 private broadcast(message:unknown){const data=JSON.stringify(message);for(const ws of this.ctx.getWebSockets())try{ws.send(data)}catch{try{ws.close()}catch{}}}
 async fetch(req:Request):Promise<Response>{
  const path=new URL(req.url).pathname;
  if(path==='/__diagnostics'&&this.env.STAGING_DIAGNOSTICS==='true')return Response.json({stage:await this.ctx.storage.get('test-ai-stage')||'none',attempts:[...this.ctx.storage.sql.exec<{count:number}>('SELECT count(*) count FROM ai_attempts')][0].count});
  if(path==='/refresh'&&req.method==='POST'){this.broadcast({type:'refresh'});return Response.json({ok:true});}
  if(path==='/reserve-bot'&&req.method==='POST'){
   let data:{user:number;source:number;room:number};try{data=await req.json()}catch{return Response.json({allowed:false},{status:400})}
   if(![data.user,data.source,data.room].every(n=>Number.isSafeInteger(n)&&n>0))return Response.json({allowed:false},{status:400});
   return Response.json({allowed:this.reserve(data.user,data.source,data.room)});
  }
  const identity=this.identity(req);if(!identity||!await this.active(identity))return new Response('Unauthorized',{status:401});
  if(path==='/connect'){
   if(req.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('Upgrade required',{status:426});
   const pair=new WebSocketPair();const client=pair[0],server=pair[1];server.serializeAttachment(identity);this.ctx.acceptWebSocket(server);
   const sql=neon(this.env.DATABASE_URL);const result=await sql.query('SELECT community_worker_welcome($1,$2) AS message',[identity.room,identity.id]);
   if(result[0]?.message)this.broadcast({type:'message',message:result[0].message});
   return new Response(null,{status:101,webSocket:client});
  }
  if(path==='/invalidate'&&req.method==='POST'){
   const data=await req.json() as {id?:unknown};const id=Number(data.id);
   if(!Number.isSafeInteger(id)||id<=0)return new Response('Invalid',{status:400});
   this.broadcast({type:'delete',id});return Response.json({ok:true});
  }
  if(path==='/send'&&req.method==='POST'){
   let data:unknown;try{data=await req.json()}catch{return new Response('Invalid',{status:400})}
   const result=await this.submit(identity,data);return Response.json(result);
  }
  return new Response('Not found',{status:404});
 }
 async webSocketMessage(ws:WebSocket,message:string|ArrayBuffer){
  if(typeof message!=='string'||message.length>4096){ws.close(1009);return}
  const identity=ws.deserializeAttachment() as Attachment|null;
  if(!identity||!await this.active(identity)){ws.close(1008,'Session expired');return}
  if(message==='ping'){ws.send('pong');return}
  let payload:Record<string,unknown>;try{payload=JSON.parse(message)}catch{ws.close(1008,'Invalid message');return}
  if(!payload||payload.type!=='send'||typeof payload.csrf!=='string'||!payload.csrf||payload.csrf.length>128){ws.close(1008,'Invalid message');return}
  const csrf=await sha256(payload.csrf);const sql=neon(this.env.DATABASE_URL);
  const session=await sql.query("SELECT 1 FROM user_sessions WHERE user_id=$1 AND token_hash=decode($2,'hex') AND csrf_token_hash=decode($3,'hex') AND revoked_at IS NULL AND expires_at>now()",[identity.id,identity.sessionHash,csrf]);
  if(!session.length){ws.close(1008,'Invalid session');return}
  const result=await this.submit(identity,payload);
  ws.send(JSON.stringify({type:'ack',client_id:payload.client_id,result}));
 }
 async webSocketClose(ws:WebSocket){try{ws.close()}catch{}}
 private async submit(identity:Attachment,data:unknown):Promise<SqlRow>{
  if(!data||typeof data!=='object')return {error:'invalid'};
  const payload=data as Record<string,unknown>;const client=payload.client_id,raw=payload.body;
  if(typeof client!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(client)||typeof raw!=='string')return {error:'invalid'};
  if(!this.hardGate(identity.id,client))return {error:'rate'};
  const reply=payload.reply_to_id??null;if(reply!==null&&(typeof reply!=='number'||!Number.isSafeInteger(reply)||reply<=0))return {error:'invalid'};
  const body=raw.trim();if(containsSensitive(body))return {error:'sensitive'};if(!body||body.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body))return {error:'invalid'};
  const sql=neon(this.env.DATABASE_URL);
  const [rules,settings,custom,recent]=await Promise.all([
   sql.query('SELECT phrase FROM community_word_rules WHERE enabled'),
   sql.query('SELECT anti_spam,anti_ads,block_solicitation,max_messages_10s,max_messages_60s,duplicate_window_seconds FROM community_moderation_settings WHERE singleton=true'),
   sql.query('SELECT phrase FROM community_advertising_rules WHERE enabled'),
   sql.query("SELECT body FROM community_messages WHERE user_id=$1 AND room_id=$2 AND deleted_at IS NULL AND created_at>now()-interval '30 seconds' ORDER BY id DESC LIMIT 2",[identity.id,identity.room])
  ]);
  if(!settings.length)return {error:'unavailable'};
  const policy=effectivePolicy(this.env,settings[0]);if(!policy.valid)return {error:'unavailable'};
  const reason=classifyWithContext(body,recent.reverse().map(r=>String(r.body)),rules.map(r=>String(r.phrase)),{...policy,advertisingRules:custom.map(r=>String(r.phrase))});
  const normalized=spamFingerprint(body);const [bodyHash,normalizedHash]=await Promise.all([sha256(body),sha256(normalized)]);
  const result=await sql.query('SELECT community_worker_submit_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) AS result',[identity.room,identity.id,client,body,reason,reply,normalized,bodyHash,normalizedHash,JSON.stringify(policy)]);
  const value=result[0]?.result as SqlRow;if(!value)return {error:'unavailable'};
  if(value.created&&value.message){const record=value.message as SqlRow;record.username=identity.username;this.broadcast({type:'message',message:record});this.ctx.waitUntil(this.maybeReply(identity,record,body));}
  return value;
 }
 private hardGate(user:number,client:string):boolean{
  const now=Date.now();return this.ctx.storage.transactionSync(()=>{
   const sql=this.ctx.storage.sql;sql.exec('DELETE FROM request_flood WHERE created_ms<?',now-60000);
   const existing=[...sql.exec<{found:number}>('SELECT 1 AS found FROM request_flood WHERE user_id=? AND client_id=?',user,client)];if(existing.length)return true;
   const count=[...sql.exec<{n:number}>('SELECT count(*) AS n FROM request_flood WHERE user_id=? AND created_ms>?',user,now-10000)][0].n;
   if(count>=30)return false;
   sql.exec('INSERT INTO request_flood(user_id,client_id,created_ms) VALUES(?,?,?)',user,client,now);return true;
  });
 }
 private reserve(user:number,source:number,room:number):boolean{
  const now=Date.now();const roomSeconds=Number(this.env.HUNG_CREATER_ROOM_COOLDOWN_SECONDS??120);const userSeconds=Number(this.env.HUNG_CREATER_USER_COOLDOWN_SECONDS??600);const max=Number(this.env.HUNG_CREATER_MAX_REPLIES_PER_HOUR??12);
  if(!Number.isFinite(roomSeconds)||!Number.isFinite(userSeconds)||!Number.isInteger(max)||roomSeconds<0||userSeconds<0||max<1)return false;
  return this.ctx.storage.transactionSync(()=>{
   const sql=this.ctx.storage.sql;sql.exec('DELETE FROM ai_attempts WHERE created_ms < ?',now-3600000);
   const stats=[...sql.exec<{total:number;last_room:number|null;last_user:number|null}>('SELECT count(*) total,max(CASE WHEN room_id=? THEN created_ms END) last_room,max(CASE WHEN user_id=? THEN created_ms END) last_user FROM ai_attempts',room,user)][0];
   if(!cooldownAllows({total:stats.total,lastRoom:stats.last_room,lastUser:stats.last_user},{roomSeconds,userSeconds,maxPerHour:max},now))return false;
   sql.exec('INSERT OR IGNORE INTO ai_attempts(source_id,user_id,room_id,created_ms) VALUES(?,?,?,?)',source,user,room,now);
   return [...sql.exec<{changes:number}>('SELECT changes() changes')][0].changes===1;
  });
 }
 private async markTest(stage:string){if(this.env.STAGING_DIAGNOSTICS==='true')await this.ctx.storage.put('test-ai-stage',stage)}
 private async maybeReply(identity:Attachment,record:SqlRow,body:string){
  try{
   await this.markTest('begin');
   const explicit=body.toLocaleLowerCase('vi').includes('@hungcreater')||Number.isSafeInteger(record.reply_to_id);
   if(!explicit&&this.env.HUNG_CREATER_AUTO_REPLY==='false'){await this.markTest('auto-disabled');return}
   if(!explicit&&!isMovieQuestion(body)){await this.markTest('not-film-question');return}
   const movies=await getCatalog(this.env);await this.markTest('catalog');
   const sql=neon(this.env.DATABASE_URL);const recent=await sql.query('SELECT body FROM community_messages WHERE room_id=$1 AND NOT is_bot AND deleted_at IS NULL AND id<$2 ORDER BY id DESC LIMIT 5',[identity.room,record.id]);
   const question=movieQuestion(body,recent.reverse().map(r=>String(r.body)),movies);
   if(!explicit){if(!question){await this.markTest('film-not-identified');return}const probability=Number(this.env.HUNG_CREATER_REPLY_PROBABILITY??.3);const random=crypto.getRandomValues(new Uint32Array(1))[0]/4294967296;if(!probabilityAllowed(probability,random)){await this.markTest('probability-skipped');return}}
   const coordinator=this.env.CHAT_ROOMS.get(this.env.CHAT_ROOMS.idFromName('bot:global'));
   const reservation=await coordinator.fetch(new Request('https://internal.invalid/reserve-bot',{method:'POST',body:JSON.stringify({user:identity.id,source:Number(record.id),room:identity.room})}));
   const permission=await reservation.json() as {allowed:boolean};if(!permission.allowed){await this.markTest('limited');return}await this.markTest('reserved');
   const film=question?.slug?movies.find(m=>m.slug===question.slug):null;
   const episodes=film?await sql.query('SELECT title FROM movie_episodes WHERE movie_slug=$1 ORDER BY sort_order,episode_key LIMIT 100',[film.slug]):[];
   const counts=film?await sql.query('SELECT count(*) AS total FROM movie_episodes WHERE movie_slug=$1',[film.slug]):[];
   const releases=film?await sql.query('SELECT release_at FROM community_movie_releases WHERE movie_slug=$1',[film.slug]):[];
   let safeBody=body.replace(/[\w.+-]+@[\w.-]+/g,'[ẩn]');
   if(record.reply_to_id){const prior=await sql.query('SELECT body FROM community_messages WHERE id=$1 AND room_id=$2 AND is_bot AND deleted_at IS NULL',[record.reply_to_id,identity.room]);if(prior[0])safeBody='Tin bot trước: '+String(prior[0].body).slice(0,500)+'\nPhản hồi: '+safeBody;}
   const prompt=`Danh mục được xác nhận: ${JSON.stringify(film||movies.map(({title,slug,genre})=>({title,slug,genre})))}. Tập hiện có trên website (không phải tổng số tập): ${JSON.stringify(episodes)}. Lịch xác nhận: ${JSON.stringify(releases)}.`;
   const verified=film?verifiedMovieFacts(body,Number(counts[0]?.total||0),releases[0]?.release_at?String(releases[0].release_at):null,film):'';
   const system=verified?'Bạn là Hưng Creater. Viết đúng một câu mở đầu thân thiện bằng tiếng Việt, thật ngắn. Không nêu dữ kiện, tên phim, thể loại, con số, ngày, năm, tập hoặc URL. Dữ kiện xác nhận sẽ được bổ sung riêng.':'Bạn là Hưng Creater. Trả lời ngắn tự nhiên bằng tiếng Việt, 1–3 câu. Chỉ dùng dữ kiện đã xác nhận; nếu thiếu thông tin hãy nói chưa rõ, không suy đoán. Không tự giới thiệu, không thêm URL bên ngoài.';
   const format=' Không dùng bất kỳ chữ số nào. Không nhắc ngày, tháng, năm, tập, lịch, phần tiếp theo hay thời điểm phát hành. Chỉ trả lời ngắn, không dùng danh sách đánh số.';
   const aiInput={messages:[{role:'system',content:system+format},{role:'system',content:prompt},{role:'user',content:safeBody.slice(0,1000)}],max_tokens:512,chat_template_kwargs:{enable_thinking:false}};
   const model=this.env.CLOUDFLARE_WORKERS_AI_MODEL||'@cf/zai-org/glm-4.7-flash';const fallback=this.env.CLOUDFLARE_WORKERS_AI_FALLBACK||'@cf/qwen/qwen3-30b-a3b-fp8';
   let safe:string|null=null;
   for(const candidate of [...new Set([model,fallback])]){
    try{
     const response=await this.env.AI.run(candidate as keyof AiModels,aiInput as never) as unknown as Record<string,unknown>;
     const choices=response.choices as Array<{message?:{content?:string}}>|undefined;
     const answer=typeof response.response==='string'?response.response:choices?.[0]?.message?.content||'';
     safe=safeConversationAnswer(answer);if(safe)break;
    }catch{/* Try only the configured fallback within the same provider. */}
   }
   if(!safe){await this.markTest('answer-rejected');return}await this.markTest('answer-valid');
   const answer=composeVerifiedReply(safe,verified,film);
   const out=await sql.query('SELECT community_worker_bot_reply($1,$2,$3) AS message',[identity.room,record.id,answer]);if(out[0]?.message)this.broadcast({type:'message',message:out[0].message});await this.markTest('complete');
  }catch(error){await this.markTest('error:'+(error instanceof Error?error.name:'unknown'));console.warn('community-bot: request failed');/* Never log prompts, sessions, credentials or provider responses. */}
 }
}
