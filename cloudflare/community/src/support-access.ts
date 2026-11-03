import {neon} from '@neondatabase/serverless';
import type {Env,Identity} from './env';
export async function supportAccess(env:Env,user:Identity,conversation:number):Promise<boolean>{
 const sql=neon(env.DATABASE_URL);
 const rows=await sql.query(`SELECT 1 FROM community_support_conversations c JOIN user_sessions s ON s.user_id=$2 AND s.token_hash=decode($3,'hex') AND s.revoked_at IS NULL AND s.expires_at>now() WHERE c.id=$1 AND (c.owner_id=$2 OR EXISTS(SELECT 1 FROM community_roles WHERE user_id=$2 AND role IN ('admin','moderator')))`,[conversation,user.id,user.sessionHash]);
 return rows.length===1;
}
export async function supportStaff(env:Env,user:Identity):Promise<boolean>{
 const sql=neon(env.DATABASE_URL);const rows=await sql.query("SELECT 1 FROM community_roles WHERE user_id=$1 AND role IN ('admin','moderator')",[user.id]);return rows.length===1;
}
