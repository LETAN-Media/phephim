const list=document.querySelector('#message-list');
let viewer=null,handleAction=()=>{},handleReply=()=>{},isSupport=false;
export function configureMessages(user,handler,reply,support=false){viewer=user;handleAction=handler;handleReply=reply;isSupport=support}
function addBodyText(element,body,isBot){
  if(!isBot){element.textContent=body;return}
  const pattern=/\/phim\/[a-z0-9-]+\//g;let previous=0;
  for(const match of body.matchAll(pattern)){
    element.append(document.createTextNode(body.slice(previous,match.index)));
    const link=document.createElement('a');link.href=match[0];link.textContent='Xem thông tin phim';element.append(link);previous=match.index+match[0].length;
  }
  element.append(document.createTextNode(body.slice(previous)));
}
function officialBadge(){
  const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','community-verified');svg.setAttribute('role','img');svg.setAttribute('aria-label','Bot chính thức đã xác minh');
  const circle=document.createElementNS(ns,'circle');circle.setAttribute('cx','12');circle.setAttribute('cy','12');circle.setAttribute('r','10');circle.setAttribute('class','community-verified-surface');
  const check=document.createElementNS(ns,'path');check.setAttribute('d','m7.8 12.1 2.8 2.9 5.7-6');check.setAttribute('class','community-verified-check');svg.append(circle,check);return svg;
}
export function renderMessage(message){
  const node=document.createElement('article');node.className=`community-message${message.is_bot?' bot':''}`;node.dataset.id=message.id;const persona=message.is_bot&&typeof message.ai_persona==='string'?message.ai_persona.trim().slice(0,40):'';node.dataset.sender=message.is_bot?`bot:${persona}`:String(message.user_id);node.dataset.time=message.created_at;
  if(viewer&&!message.is_bot&&Number(viewer.id)===Number(message.user_id))node.classList.add('is-own');
  const avatar=document.createElement('span');avatar.className='community-avatar';
  if(message.is_bot&&!persona){const image=document.createElement('img');image.src='/cong-dong/static/images/hung-creater.webp';image.alt='';image.className='community-avatar-image';image.addEventListener('error',()=>{avatar.textContent='HC'},{once:true});avatar.append(image)}
  else avatar.textContent=message.is_bot?Array.from(persona)[0].toLocaleUpperCase('vi'):Array.from(message.username||'?')[0].toLocaleUpperCase('vi');
  const content=document.createElement('div');content.className='community-message-body';
  const meta=document.createElement('div');meta.className='community-message-meta';const name=document.createElement('strong');name.textContent=message.is_bot?(persona||'Hưng Creater'):message.username||'Thành viên';meta.append(name);
  if(message.is_bot){if(!persona)meta.append(officialBadge());const badge=document.createElement('span');badge.className='community-bot-label';badge.textContent=persona?'AI':'BOT CHÍNH THỨC';meta.append(badge)}
  const timestamp=message.created_at?new Date(message.created_at):null;if(timestamp&&!Number.isNaN(timestamp.getTime())){const time=document.createElement('time');time.dateTime=timestamp.toISOString();time.textContent=timestamp.toLocaleString('vi-VN',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'});meta.append(time)}
  const text=document.createElement('p');addBodyText(text,message.body,message.is_bot);content.append(meta,text);
  if(viewer&&message.is_bot&&!persona&&!isSupport){const reply=document.createElement('button');reply.type='button';reply.className='community-message-action';reply.textContent='Trả lời';reply.addEventListener('click',()=>handleReply(message));content.append(reply)}
  if(viewer&&!message.is_bot&&!isSupport){const action=document.createElement('button');action.type='button';action.className='community-message-action';action.textContent=viewer.id===message.user_id?'Xóa':'Báo cáo';action.addEventListener('click',()=>handleAction(message,node,action));content.append(action)}
  node.append(avatar,content);return node;
}
function groupMessages(){let previous=null;for(const node of list.children){const same=previous&&node.dataset.sender===previous.dataset.sender&&Number.isFinite(Date.parse(node.dataset.time))&&Date.parse(node.dataset.time)-Date.parse(previous.dataset.time)>=0&&Date.parse(node.dataset.time)-Date.parse(previous.dataset.time)<300000;node.classList.toggle('is-grouped',!!same);previous=node}}
export function replaceMessages(messages){list.replaceChildren(...messages.map(renderMessage));groupMessages()}
export function appendMessage(message){if(list.querySelector(`[data-id="${Number(message.id)}"]`))return;list.append(renderMessage(message));groupMessages()}
export function prependMessages(messages){list.prepend(...messages.map(renderMessage));groupMessages()}
export function removeMessage(id){list.querySelector(`[data-id="${Number(id)}"]`)?.remove();groupMessages()}
