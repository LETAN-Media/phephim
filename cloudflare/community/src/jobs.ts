import {neon} from '@neondatabase/serverless';
import type {Env} from './env';
import {deliverOne} from './telegram/notifications';
import {processNotification} from './notification-events';
import {getCatalog} from './catalog';

export async function runJobs(env:Env):Promise<void>{
 const sql=neon(env.DATABASE_URL);
 await sql.query('SELECT community_worker_cleanup()');
 await sql.query('SELECT community_support_cleanup()');
 if(env.COMMUNITY_CLEANUP_ONLY==='true')return;
 try{const movies=await getCatalog(env);await sql.query('SELECT community_worker_sync_catalog($1::jsonb)',[JSON.stringify(movies.map(m=>m.slug))]);}catch{/* A missing catalog must not generate speculative events. */}
 for(let i=0;i<10;i++){
  const rows=await sql.query('SELECT community_worker_scheduled_publish($1,$2) AS result',[env.TELEGRAM_CHANNEL_ID||'',env.TELEGRAM_CHANNEL_SYNC_ENABLED==='true']);
  const result=rows[0]?.result as {room_id:number;message:unknown;pinned:boolean}|null;if(!result)break;
  const room=env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName(`room:${result.room_id}`));
  await room.fetch(new Request('https://internal.invalid/refresh',{method:'POST'}));
 }
 await processNotification(env);
 for(let i=0;i<10;i++)await deliverOne(env);
}
