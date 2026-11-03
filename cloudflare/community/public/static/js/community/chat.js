import {configureMessages,replaceMessages,appendMessage,prependMessages,removeMessage} from './messages.js';
import {renderPins} from './pinned-messages.js';
import {connectRealtime} from './realtime.js';
import {renderRooms,closeRooms} from './rooms.js';
import './viewport.js';
import {loadSupportQueue,clearSupportQueue,showSupportTools,setupSupportStatus} from './support.js';
const area=document.querySelector('#messages'),list=document.querySelector('#message-list'),older=document.querySelector('#load-older'),form=document.querySelector('#chat-form'),input=document.querySelector('#chat-input'),notice=document.querySelector('#chat-status'),connection=document.querySelector('#connection-status');
let room=null,disconnect=null,user=null,busy=false,pending=null,replyTo=null,selection=0,isStaff=false;
let refreshRequest=0,lastRenderedRequest=0,messageRevision=0;
const drafts=new Map();
const draftKey=target=>`${target.kind||'community'}:${target.id}`;
const replyContext=document.querySelector('#reply-context');
function cancelReply(){replyTo=null;replyContext.hidden=true}
function replyToBot(message){replyTo=message.id;replyContext.hidden=false;input.focus()}
document.querySelector('#reply-cancel').addEventListener('click',cancelReply);
const csrf=()=>decodeURIComponent(document.cookie.split('; ').find(v=>v.startsWith('__Host-phe_csrf='))?.split('=')[1]||'');
async function api(path,options={}){const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(typeof error.detail==='string'?error.detail:'Không thể thực hiện yêu cầu. Vui lòng thử lại.')}return response.json()}
const historyPath=target=>target.kind==='support'?`/api/support/conversations/${target.id}/messages`:`/api/community/rooms/${target.id}/messages`;
async function refresh(){if(!room)return;const target=room,request=++refreshRequest,revision=messageRevision,previousTop=area.scrollTop,nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<100;const [messages,pins]=await Promise.all([api(historyPath(target)),target.kind==='support'?Promise.resolve({pins:[]}):api(`/api/community/rooms/${target.id}/pins`)]);if(room!==target||request<lastRenderedRequest||revision!==messageRevision)return;lastRenderedRequest=request;replaceMessages(messages.messages);renderPins(pins.pins);older.hidden=messages.messages.length<30;area.scrollTop=nearBottom?area.scrollHeight:previousTop}
function event(data){if(data.type==='refresh'){refresh().catch(()=>notice.textContent='Không thể tải nội dung. Vui lòng thử lại.');return}if(data.type==='delete'){messageRevision++;removeMessage(data.id);return}if(data.type==='message'){messageRevision++;const near=area.scrollHeight-area.scrollTop-area.clientHeight<100;appendMessage(data.message);if(near)area.scrollTop=area.scrollHeight}}
async function selectRoom(selected){
 const serial=++selection;if(room)drafts.set(draftKey(room),input.value);input.value='';input.style.height='auto';disconnect?.();disconnect=null;cancelReply();pending=null;room=null;connection.textContent='Đang kết nối';closeRooms();document.querySelector('#room-title').textContent=selected.name;renderPins([]);replaceMessages([]);older.hidden=true;notice.textContent='';document.querySelector('#support-retention').hidden=selected.kind!=='support';showSupportTools(false);
 if(selected.kind==='support'&&!user){connection.textContent='Chỉ xem';notice.textContent='Đăng nhập để liên hệ Hỗ Trợ.';return}
 let target=selected;
 if(selected.kind==='support'&&!selected.id){const data=await api('/api/support/conversation',{method:'POST',headers:{'X-CSRF-Token':csrf()}});if(serial!==selection)return;target={...selected,id:data.id}}
 if(serial!==selection)return;room=target;input.value=drafts.get(draftKey(target))||'';input.dispatchEvent(new Event('input'));configureMessages(user,messageAction,replyToBot,target.kind==='support');
 if(target.kind==='support'){
  try{isStaff=await loadSupportQueue(item=>selectRoom(item).catch(()=>notice.textContent='Không thể mở hội thoại.'))}catch{isStaff=false;clearSupportQueue()}
  if(serial!==selection)return;showSupportTools(isStaff);
 }else{clearSupportQueue();isStaff=false}
 await refresh();if(serial!==selection)return;if(user)disconnect=connectRealtime(target.id,data=>{if(room===target)event(data)},text=>{if(room===target)connection.textContent=text},target.kind==='support'?'support':'community');else connection.textContent='Chỉ xem';
}
setupSupportStatus(async status=>{if(!room||room.kind!=='support'||!isStaff)return;const target=room;try{await api(`/api/support/conversations/${target.id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf()},body:JSON.stringify({status})});if(room!==target)return;notice.textContent=status==='resolved'?'Đã đánh dấu yêu cầu là đã giải quyết.':'Đã đánh dấu yêu cầu đang xử lý.';await loadSupportQueue(item=>selectRoom(item).catch(()=>notice.textContent='Không thể mở hội thoại.'))}catch{notice.textContent='Không thể cập nhật yêu cầu.'}});
async function messageAction(message,node,button){
 if(message.user_id===user?.id){
  button.disabled=true;
  try{await api(`/api/community/messages/${message.id}`,{method:'DELETE',headers:{'X-CSRF-Token':csrf()}});messageRevision++;removeMessage(message.id)}catch{notice.textContent='Không thể xóa tin nhắn.';button.disabled=false}
  return;
 }
 if(node.querySelector('.community-report'))return;
 const report=document.createElement('form');report.className='community-report';
 const label=document.createElement('label');label.textContent='Lý do báo cáo';const input=document.createElement('input');input.required=true;input.maxLength=500;input.placeholder='Nhập lý do';label.append(input);
 const submit=document.createElement('button');submit.type='submit';submit.textContent='Gửi báo cáo';report.append(label,submit);node.querySelector('.community-message-body').append(report);input.focus();
 report.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;try{await api(`/api/community/messages/${message.id}/report`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf()},body:JSON.stringify({reason:input.value.trim()})});report.remove();notice.textContent='Đã gửi báo cáo.'}catch{notice.textContent='Không thể gửi báo cáo.';submit.disabled=false}});
}
function showWarning(result){
 notice.textContent=moderation(result);
 if(!result.violation_id)return;
 const button=document.createElement('button');button.type='button';button.className='community-appeal';button.textContent='Gửi kháng nghị';
 button.addEventListener('click',async()=>{button.disabled=true;try{await api(`/api/community/violations/${encodeURIComponent(result.violation_id)}/appeal`,{method:'POST',headers:{'X-CSRF-Token':csrf()}});button.textContent='Đã gửi kháng nghị'}catch(error){notice.textContent=error.message||'Không thể gửi kháng nghị.'}});
 notice.append(' ',button);
}
function moderation(result){
 const count=result.warning_count||0,reason=result.reason==='url'?'chứa liên kết':result.reason==='language'?'có ngôn từ không phù hợp':result.reason==='advertising'||result.reason==='solicitation'?'có nội dung quảng cáo hoặc lôi kéo':result.reason==='spam'?'có nội dung spam':'vi phạm quy định cộng đồng';
 if(result.banned||count===3){const until=result.banned_until?new Date(result.banned_until).toLocaleString('vi-VN'):'';return `Hưng Creater: Bạn đã nhận 3/3 cảnh báo. Quyền chat bị khóa 24 giờ, đến ${until}.`}
 if(count===2)return `Hưng Creater: Tin nhắn bị ẩn vì ${reason}. Bạn đã nhận 2/3 cảnh báo; lần tiếp theo sẽ bị khóa chat 24 giờ.`;
 return `Hưng Creater: Tin nhắn bị ẩn vì ${reason}. Cảnh báo ${count}/3.`;
}
form.addEventListener('submit',async event=>{event.preventDefault();if(busy||!room||!input.value.trim())return;busy=true;form.querySelector('button').disabled=true;notice.textContent='Đang gửi…';const body=input.value.trim();if(!pending||pending.body!==body||pending.room!==room.id||pending.reply!==replyTo)pending={body,room:room.id,reply:replyTo,id:crypto.randomUUID()};try{const target=room;const payload=target.kind==='support'?{client_id:pending.id,body}:{client_id:pending.id,reply_to_id:pending.reply,body};const result=await api(historyPath(target),{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf()},body:JSON.stringify(payload)});if(room!==target)return;pending=null;if(result.moderation){showWarning(result.moderation);return}messageRevision++;notice.textContent='';input.value='';drafts.delete(draftKey(target));input.style.height='auto';cancelReply();appendMessage(result.message);area.scrollTop=area.scrollHeight}catch(error){notice.textContent=error.message||'Không thể gửi tin nhắn. Vui lòng thử lại.'}finally{busy=false;form.querySelector('button').disabled=false}});
input.addEventListener('keydown',event=>{if(event.key!=='Enter'||event.shiftKey||event.isComposing||event.repeat)return;event.preventDefault();form.requestSubmit()});
older.addEventListener('click',async()=>{const first=list.firstElementChild;if(!first||!room)return;const height=area.scrollHeight;try{const target=room;const data=await api(`${historyPath(target)}?before=${encodeURIComponent(first.dataset.id)}`);if(room!==target)return;prependMessages(data.messages);older.hidden=data.messages.length<30;area.scrollTop+=area.scrollHeight-height}catch{notice.textContent='Không thể tải tin nhắn trước.'}});
async function start(){try{const [rooms,account]=await Promise.all([api('/api/community/rooms'),fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'})]);if(account.ok)user=await account.json();if(user){const name=String(user.username||'Thành viên');document.querySelector('[data-community-name]').textContent=name;document.querySelector('[data-community-avatar]').textContent=Array.from(name)[0]?.toLocaleUpperCase('vi')||'?';document.querySelector('[data-community-account]').hidden=false;document.querySelector('[data-community-login]').hidden=true}configureMessages(user,messageAction,replyToBot);form.hidden=!user;document.querySelector('#chat-login').hidden=!!user;const published=rooms.rooms.filter(item=>item.slug==='cong-dong-chung');if(!published.length){notice.textContent='Chưa có phòng trò chuyện.';return}renderRooms(published,item=>selectRoom(item).catch(()=>notice.textContent='Không thể mở phòng.'));await selectRoom({...published[0],name:'Cộng Đồng'})}catch{connection.textContent='Chưa kết nối';notice.textContent='Không thể tải cộng đồng. Vui lòng thử lại.'}}
window.addEventListener('pagehide',()=>disconnect?.());start();
