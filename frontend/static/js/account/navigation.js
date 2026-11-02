import {request,setStatus} from './api.js';
const logout=document.querySelector('.account-logout');
const status=document.querySelector('.sidebar-status');
const nameNode=document.querySelector('[data-user-name]');
const emailNode=document.querySelector('[data-user-email]');
const verification=document.querySelector('[data-verification]');
const avatar=document.querySelector('[data-avatar]');
export function displayUser(user) {
  nameNode.textContent=user.username; emailNode.textContent=user.email;
  document.dispatchEvent(new CustomEvent('phe:user-updated',{detail:user}));
  const headerName=document.querySelector('.account-toggle span');
  if(headerName) headerName.textContent=user.username;
  avatar.textContent=Array.from(user.username)[0]?.toLocaleUpperCase('vi') || '';
  verification.hidden=false; verification.dataset.verified=String(user.email_verified);
  verification.textContent=user.email_verified ? 'Email đã xác minh' : 'Email chưa xác minh';
}
export const currentUser=request('/api/users/me').then(user=>{displayUser(user);return user;}).catch(error=>{
  nameNode.textContent=error.status===401?'Vui lòng đăng nhập':'Không thể tải tài khoản';
  emailNode.textContent=error.status===401?'Đăng nhập để xem và quản lý tài khoản.':'Vui lòng tải lại trang để thử lại.';
  if(error.status===401){const link=document.createElement('a');link.href='/dang-nhap/';link.textContent='Đăng nhập';link.className='identity-login';emailNode.insertAdjacentElement('afterend',link);}
  logout.hidden=true;
  throw error;
});
// A page module also handles this rejection; keep the shared promise safe during loading.
currentUser.catch(()=>{});
logout.addEventListener('click',async()=>{
  logout.disabled=true;setStatus(status,'Đang đăng xuất…');
  try {await request('/api/auth/logout',{method:'POST'});location.href='/';}
  catch(error){setStatus(status,error.message,'error');logout.disabled=false;}
});
