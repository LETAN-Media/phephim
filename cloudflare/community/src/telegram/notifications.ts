import {neon} from '@neondatabase/serverless';
import type {Env} from '../env';
import {sendTelegram} from './client';

export async function deliverOne(env:Env):Promise<void>{
 if(!env.TELEGRAM_BOT_TOKEN)return;
 const sql=neon(env.DATABASE_URL);const rows=await sql.query('SELECT community_worker_claim_delivery() AS item');
 const item=rows[0]?.item as {id:number;destination:string;body:string}|null;if(!item)return;
 if(item.destination!==env.TELEGRAM_CHANNEL_ID){
  if(!/^\d+$/.test(item.destination)){await sql.query("UPDATE telegram_deliveries SET state='failed',updated_at=now() WHERE id=$1",[item.id]);return}
  const active=await sql.query('SELECT 1 FROM telegram_subscribers WHERE telegram_user_id=$1 AND active',[item.destination]);
  if(!active.length){await sql.query("UPDATE telegram_deliveries SET state='failed',updated_at=now() WHERE id=$1",[item.id]);return}
 }
 // Telegram has no idempotency key; an indeterminate response must never be retried automatically.
 const sent=await sendTelegram(env.TELEGRAM_BOT_TOKEN,item.destination,item.body);
 await sql.query("UPDATE telegram_deliveries SET state=$2,telegram_message_id=$3,updated_at=now() WHERE id=$1 AND state='sending'",[item.id,sent?'sent':'unknown',sent]);
}
