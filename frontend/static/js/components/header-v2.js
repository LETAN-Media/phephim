const header=document.querySelector('[data-header-v2]');
if(header){
  const menuButton=header.querySelector('.header-v2-menu-button');
  const drawer=header.querySelector('.header-v2-drawer');
  const accountButton=header.querySelector('.header-v2-account-button');
  const accountMenu=header.querySelector('.header-v2-account-menu');
  const guest=header.querySelector('[data-v2-guest]');
  const userLinks=header.querySelector('[data-v2-user]');
  const avatar=header.querySelector('[data-v2-avatar]');
  const name=header.querySelector('[data-v2-name]');
  const status=header.querySelector('[data-v2-status]');
  const logout=header.querySelector('[data-v2-logout]');
  function drawerOpen(open){drawer.classList.toggle('is-open',open);menuButton.setAttribute('aria-expanded',String(open));menuButton.setAttribute('aria-label',open?'Đóng menu':'Mở menu');}
  function accountOpen(open){accountMenu.hidden=!open;accountButton.setAttribute('aria-expanded',String(open));}
  function showUser(user){guest.hidden=true;userLinks.hidden=false;name.textContent=user.username;avatar.textContent=Array.from(user.username)[0]?.toLocaleUpperCase('vi')||'';accountButton.setAttribute('aria-label',`Tài khoản ${user.username}`);}
  document.addEventListener('phe:user-updated',event=>showUser(event.detail));
  menuButton.addEventListener('click',()=>{const open=menuButton.getAttribute('aria-expanded')!=='true';accountOpen(false);drawerOpen(open);});
  accountButton.addEventListener('click',()=>{const open=accountButton.getAttribute('aria-expanded')!=='true';drawerOpen(false);accountOpen(open);});
  drawer.addEventListener('click',event=>{if(event.target.closest('a'))drawerOpen(false);});
  document.addEventListener('click',event=>{if(!header.querySelector('.header-v2-account').contains(event.target))accountOpen(false);if(!drawer.contains(event.target)&&!menuButton.contains(event.target))drawerOpen(false);});
  document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(!accountMenu.hidden){accountOpen(false);accountButton.focus();}else if(menuButton.getAttribute('aria-expanded')==='true'){drawerOpen(false);menuButton.focus();}});
  fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'}).then(async response=>{
    if(response.status===401)return;
    if(!response.ok)throw new Error();
    const user=await response.json();showUser(user);
  }).catch(()=>{guest.hidden=true;status.textContent='Không thể tải trạng thái tài khoản.';});
  logout.addEventListener('click',async()=>{
    logout.disabled=true;status.textContent='Đang đăng xuất…';
    const cookie=document.cookie.split('; ').find(value=>value.startsWith('__Host-phe_csrf='))?.slice('__Host-phe_csrf='.length);
    try{const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',headers:cookie?{'X-CSRF-Token':decodeURIComponent(cookie)}:{}});if(!response.ok)throw new Error();location.href='/';}
    catch{status.textContent='Không thể đăng xuất. Vui lòng thử lại.';logout.disabled=false;}
  });
}
document.querySelectorAll('[data-footer-v2-year]').forEach(node=>{node.textContent=String(new Date().getFullYear());});
