import {DurableObject} from 'cloudflare:workers';
import {neon} from '@neondatabase/serverless';
import type {Env,Identity} from './env';
import {supportAccess} from './support-access';
type Att=Identity&{conversation:number};
export class SupportRoom extends DurableObject<Env>{
 private identity(req:Request):Att|null{
  const id=Number(req.headers.get('x-internal-user')),conversation=Number(req.headers.get('x-internal-conversation')),username=req.headers.get('x-internal-name')||'',sessionHash=req.headers.get('x-internal-session')||'';
  if(!Number.isSafeInteger(id)||id<=0||!Number.isSafeInteger(conversation)||conversation<=0||!/^[a-f0-9]{64}$/.test(sessionHash))return null;
  return {id,username,conversation,sessionHash};
 }
 async fetch(req:Request):Promise<Response>{
  const user=this.identity(req);if(!user||!await supportAccess(this.env,user,user.conversation))return new Response('Not found',{status:404});
  const path=new URL(req.url).pathname;
  if(path==='/connect'){
   if(req.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('Upgrade required',{status:426});
   const pair=new WebSocketPair();pair[1].serializeAttachment(user);this.ctx.acceptWebSocket(pair[1]);return new Response(null,{status:101,webSocket:pair[0]});
  }
  if(path!=='/send'||req.method!=='POST')return new Response('Not found',{status:404});
  let payload:{client_id?:unknown;body?:unknown};try{payload=await req.json()}catch{return Response.json({error:'invalid'},{status:400})}
  const client=payload.client_id,body=typeof payload.body==='string'?payload.body.trim():'';
  if(typeof client!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(client)||!body||body.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body))return Response.json({error:'invalid'},{status:400});
  const sql=neon(this.env.DATABASE_URL);const rows=await sql.query('SELECT community_support_send($1,$2,$3,$4) AS result',[user.conversation,user.id,client,body]);const result=rows[0]?.result as Record<string,unknown>;
  if(!result)return Response.json({error:'unavailable'},{status:503});
  if(result.message){const message=result.message as Record<string,unknown>;message.username=user.username;message.user_id=message.author_id;delete message.author_id;if(result.created)await this.broadcast(user.conversation,{type:'message',message})}
  return Response.json(result);
 }
 private async broadcast(conversation:number,event:unknown){
  const data=JSON.stringify(event);
  for(const ws of this.ctx.getWebSockets()){
   const user=ws.deserializeAttachment() as Att|null;
   try{if(user&&user.conversation===conversation&&await supportAccess(this.env,user,conversation))ws.send(data);else ws.close(1008)}catch{try{ws.close()}catch{}}
  }
 }
 async webSocketMessage(ws:WebSocket,message:string|ArrayBuffer){
  const user=ws.deserializeAttachment() as Att|null;if(!user||!await supportAccess(this.env,user,user.conversation)){ws.close(1008);return}
  if(message==='ping'){ws.send('pong');return}
  ws.close(1008);
 }
 async webSocketClose(ws:WebSocket){try{ws.close()}catch{}}
}
