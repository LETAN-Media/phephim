import {neon} from '@neondatabase/serverless';
import type {Env} from './env';
import {getCatalog} from './catalog';

type Event={id:number;event_type:string;movie_slug:string;episode_key:string|null;release_at:string|null};
export async function processNotification(env:Env):Promise<void>{
 const sql=neon(env.DATABASE_URL);const lease=crypto.randomUUID();
 const result=await sql.query('SELECT community_worker_claim_event($1) AS event',[lease]);const event=result[0]?.event as Event|null;if(!event)return;
 try{
  const movie=(await getCatalog(env)).find(m=>m.slug===event.movie_slug);if(!movie)throw new Error('unverified');
  let title=movie.title;
  if(event.event_type==='episode.published'){
   const rows=await sql.query('SELECT title FROM movie_episodes WHERE movie_slug=$1 AND episode_key=$2',[event.movie_slug,event.episode_key]);if(!rows.length)throw new Error('unverified');title+=' · '+String(rows[0].title);
  }else if(event.event_type==='movie.schedule_updated'){
   const rows=await sql.query('SELECT release_at FROM community_movie_releases WHERE movie_slug=$1 AND release_at=$2',[event.movie_slug,event.release_at]);if(!rows.length)throw new Error('unverified');title+=' · '+new Date(String(event.release_at)).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})+' (giờ Việt Nam)';
  }
  const input={messages:[{role:'system',content:'Viết một câu ngắn bằng tiếng Việt mời cộng đồng chia sẻ cảm nhận. Không nêu bất kỳ tên phim, dữ kiện, số, lịch, ngày, giờ, tập hoặc đường dẫn.'},{role:'user',content:'Viết lời mời ngắn.'}],max_tokens:256};
  let generated:Record<string,unknown>;try{generated=await env.AI.run((env.CLOUDFLARE_WORKERS_AI_MODEL||'@cf/zai-org/glm-4.7-flash') as keyof AiModels,input as never) as unknown as Record<string,unknown>}catch{generated=await env.AI.run((env.CLOUDFLARE_WORKERS_AI_FALLBACK||'@cf/qwen/qwen3-30b-a3b-fp8') as keyof AiModels,input as never) as unknown as Record<string,unknown>}
  const choices=generated.choices as Array<{message?:{content?:string}}>|undefined;
  const text=(typeof generated.response==='string'?generated.response:choices?.[0]?.message?.content||'').trim();
  if(!text||text.length>200||/\d|https?:\/\/|www\.|<\/?[a-z]|phát hành|ra mắt|lịch|tập|ngày|giờ|tuần|tháng|năm/i.test(text))throw new Error('invalid');
  const body=`${text}\n\n${title}\n/phim/${event.movie_slug}/`;
  const saved=await sql.query('SELECT community_worker_finish_event($1,$2,$3,$4,$5) AS result',[event.id,lease,body,env.TELEGRAM_CHANNEL_ID||'',env.TELEGRAM_CHANNEL_SYNC_ENABLED==='true']);
  const published=saved[0]?.result as {room_id:number}|null;if(published){const room=env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName(`room:${published.room_id}`));await room.fetch(new Request('https://internal.invalid/refresh',{method:'POST'}));}
 }catch{
  await sql.query("UPDATE community_notification_events SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,next_attempt_at=now()+interval '5 minutes',lease_until=NULL,lease_token=NULL WHERE id=$1 AND state='processing' AND lease_token=$2",[event.id,lease]);
 }
}
