const queue=document.querySelector('#support-queue'),list=document.querySelector('#support-queue-list'),tools=document.querySelector('#support-tools');
export function showSupportTools(visible){tools.hidden=!visible}
export async function loadSupportQueue(onSelect){
 const response=await fetch('/api/support/conversations',{credentials:'same-origin',cache:'no-store'});
 if(!response.ok){queue.hidden=true;list.replaceChildren();return false}
 const data=await response.json();list.replaceChildren();
 for(const item of data.conversations){
  const button=document.createElement('button');button.type='button';button.className='community-room-button';
  const status=item.needs_reply?' · Chưa phản hồi':item.status==='resolved'?' · Đã giải quyết':'';button.textContent=String(item.username)+status;
  button.addEventListener('click',()=>onSelect({kind:'support',id:item.id,name:'Hỗ Trợ · '+String(item.username)}));list.append(button);
 }
 queue.hidden=false;return true;
}
export function clearSupportQueue(){queue.hidden=true;list.replaceChildren();showSupportTools(false)}
export function setupSupportStatus(handler){for(const button of tools.querySelectorAll('[data-support-status]'))button.addEventListener('click',()=>handler(button.dataset.supportStatus))}
