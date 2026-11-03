export async function sendTelegram(token:string,chatId:string|number,text:string):Promise<number|null>{
 if(!token||!text||text.length>4096)return null;
 try{
  const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)return null;
  const payload=await response.json() as {ok?:boolean;result?:{message_id?:number}};
  return payload.ok&&typeof payload.result?.message_id==='number'?payload.result.message_id:null;
 }catch{return null} // Never log the token-bearing URL or exception.
}
