const button=document.querySelector('.community-room-toggle'),panel=document.querySelector('#community-rooms');
const shell=document.querySelector('.community-shell'),desktopButton=document.querySelector('.community-desktop-toggle');
const desktop=window.matchMedia('(min-width:701px)');
const preferenceKey='phe-community-sidebar-open';
let desktopOpen=true;
try{desktopOpen=localStorage.getItem(preferenceKey)!=='false'}catch{}
function applyDesktop(){
 const collapsed=desktop.matches&&!desktopOpen;shell.classList.toggle('is-sidebar-collapsed',collapsed);
 panel.inert=collapsed;desktopButton.setAttribute('aria-expanded',String(!collapsed));
 desktopButton.setAttribute('aria-label',collapsed?'Mở thanh phòng':'Đóng thanh phòng');
 desktopButton.querySelector('use').setAttribute('href',collapsed?'#community-panel-left-open':'#community-panel-left-close');
}
function setMobileOpen(open){panel.classList.toggle('is-open',open);button.setAttribute('aria-expanded',String(open))}
export function closeRooms(){if(!desktop.matches)setMobileOpen(false)}
export function renderRooms(rooms,onSelect){
 const container=document.querySelector('#rooms-list');container.replaceChildren();
 rooms.filter(room=>room.slug==='cong-dong-chung').forEach(room=>{
  const item=document.createElement('button');item.type='button';item.className='community-room-button';item.textContent='Cộng Đồng';
  item.addEventListener('click',()=>{container.querySelectorAll('.community-room-button').forEach(el=>el.classList.remove('is-active'));item.classList.add('is-active');closeRooms();onSelect({...room,name:'Cộng Đồng'})});
  container.append(item);
 });
 const support=document.createElement('button');support.type='button';support.className='community-room-button';support.textContent='Hỗ Trợ';support.addEventListener('click',()=>{container.querySelectorAll('.community-room-button').forEach(el=>el.classList.remove('is-active'));support.classList.add('is-active');closeRooms();onSelect({kind:'support',name:'Hỗ Trợ'})});container.append(support);
 container.firstElementChild?.classList.add('is-active');
}
button.addEventListener('click',()=>setMobileOpen(!panel.classList.contains('is-open')));
desktopButton.addEventListener('click',()=>{desktopOpen=!desktopOpen;try{localStorage.setItem(preferenceKey,String(desktopOpen))}catch{}applyDesktop()});
document.querySelector('.community-sidebar-close').addEventListener('click',closeRooms);
document.querySelector('.community-backdrop').addEventListener('click',closeRooms);
document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(desktop.matches&&desktopOpen){desktopOpen=false;try{localStorage.setItem(preferenceKey,'false')}catch{}applyDesktop();desktopButton.focus();return}if(!desktop.matches&&panel.classList.contains('is-open')){setMobileOpen(false);button.focus()}});
desktop.addEventListener('change',()=>{setMobileOpen(false);applyDesktop()});applyDesktop();
