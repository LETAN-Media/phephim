const csrf=()=>document.cookie.split('; ').find(x=>x.startsWith('__Host-phe_csrf='))?.split('=')[1] || '';
async function api(path, data, method='POST') {
  const options={method,credentials:'same-origin',headers:{'Content-Type':'application/json'}};
  if(csrf()) options.headers['X-CSRF-Token']=decodeURIComponent(csrf());
  if(data) options.body=JSON.stringify(data);
  const response=await fetch('/api/'+path,options);
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(typeof body.detail==='string'?body.detail:'Không thể xử lý yêu cầu. Vui lòng thử lại.');
  return body;
}
function setupHeader(){
  const nav=document.querySelector('.site-nav'); if(!nav)return;
  const account=document.createElement('div'); account.className='account';
  account.innerHTML='<a class="account-login" href="/dang-nhap/">Đăng nhập</a>';nav.append(account);
  fetch('/api/auth/me',{credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(user=>{
    if(!user)return;
    account.innerHTML='<button class="account-toggle" aria-expanded="false" aria-label="Tài khoản">◉ <span></span> ▾</button><div class="account-menu" hidden><a href="/ho-so/">Hồ sơ cá nhân</a><a href="/doi-mat-khau/">Đổi mật khẩu</a><button type="button" class="logout">Đăng xuất</button></div>';
    account.querySelector('.account-toggle span').textContent=user.username;
    const toggle=account.querySelector('.account-toggle'),menu=account.querySelector('.account-menu');
    toggle.addEventListener('click',()=>{menu.hidden=!menu.hidden;toggle.setAttribute('aria-expanded',String(!menu.hidden))});
    document.addEventListener('click',e=>{if(!account.contains(e.target)){menu.hidden=true;toggle.setAttribute('aria-expanded','false')}});
    account.querySelector('.logout').addEventListener('click',async()=>{try{await api('auth/logout');location.href='/'}catch(e){alert(e.message)}});
  }).catch(()=>{});
}
setupHeader();
const root=document.querySelector('#auth-content');
if(root){
  const route=location.pathname.split('/').filter(Boolean)[0];
  const password=(name,label,autocomplete='new-password')=>`<label>${label}<span class="password-wrap"><input name="${name}" type="password" minlength="10" maxlength="1024" autocomplete="${autocomplete}" required><button class="show-password" type="button">Hiện</button></span></label>`;
  const forms={
    'dang-ky':`<h1>Tạo tài khoản</h1><p>Khám phá điện ảnh cùng PHE PHIM AI.</p><form data-action="register"><label>Tên người dùng<input name="username" autocomplete="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9_]+" required></label><label>Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label>${password('password','Mật khẩu')}${password('confirm','Xác nhận mật khẩu')}<label class="check"><input type="checkbox" name="terms" required> Tôi đồng ý với <a href="/dieu-khoan/">điều khoản sử dụng</a>.</label><button class="primary" type="submit">Đăng ký</button></form><p>Đã có tài khoản? <a href="/dang-nhap/">Đăng nhập</a></p>`,
    'dang-nhap':`<h1>Chào mừng trở lại</h1><p>Đăng nhập để tiếp tục hành trình điện ảnh.</p><form data-action="login"><label>Email hoặc tên người dùng<input name="identifier" autocomplete="username" maxlength="254" required></label>${password('password','Mật khẩu','current-password')}<label class="check"><input name="remember" type="checkbox"> Ghi nhớ đăng nhập</label><button class="primary" type="submit">Đăng nhập</button></form><p><a href="/quen-mat-khau/">Quên mật khẩu?</a> · Chưa có tài khoản? <a href="/dang-ky/">Đăng ký</a></p>`,
    'quen-mat-khau':`<h1>Quên mật khẩu</h1><p>Nhập email để nhận hướng dẫn đặt lại mật khẩu.</p><form data-action="forgot-password"><label>Email<input name="email" type="email" autocomplete="email" required maxlength="254"></label><button class="primary">Gửi hướng dẫn</button></form><p><a href="/dang-nhap/">Quay lại đăng nhập</a></p>`,
    'dat-lai-mat-khau':`<h1>Đặt lại mật khẩu</h1><form data-action="reset-password">${password('password','Mật khẩu mới')}${password('confirm','Xác nhận mật khẩu')}<button class="primary">Đặt lại mật khẩu</button></form>`,
    'doi-mat-khau':`<h1>Đổi mật khẩu</h1><form data-action="change-password">${password('current_password','Mật khẩu hiện tại','current-password')}${password('new_password','Mật khẩu mới')}${password('confirm','Xác nhận mật khẩu mới')}<button class="primary">Lưu mật khẩu</button></form>`,
    'ho-so':`<h1>Hồ sơ cá nhân</h1><form data-action="profile"><label>Tên người dùng<input name="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9_]+" required></label><label>Email<input name="email" type="email" disabled></label><button class="primary">Lưu thay đổi</button></form>`,
    'xac-minh-email':`<h1>Xác minh email</h1><p>Đang xác minh liên kết của bạn…</p>`,
    'dieu-khoan':`<h1>Điều khoản sử dụng</h1><p>Điều khoản sử dụng đang được cập nhật. Vui lòng liên hệ đơn vị vận hành để biết thêm thông tin.</p>`
  };
  root.innerHTML=(forms[route]||'<h1>Không tìm thấy trang</h1>')+'<p class="auth-message" role="status" aria-live="polite"></p>';
  const msg=root.querySelector('.auth-message');
  root.querySelectorAll('.show-password').forEach(btn=>btn.addEventListener('click',()=>{const input=btn.previousElementSibling;input.type=input.type==='password'?'text':'password';btn.textContent=input.type==='password'?'Hiện':'Ẩn'}));
  if(route==='ho-so')fetch('/api/users/me').then(r=>{if(!r.ok)throw Error('Vui lòng đăng nhập để xem hồ sơ.');return r.json()}).then(u=>{root.querySelector('[name=username]').value=u.username;root.querySelector('[name=email]').value=u.email}).catch(e=>msg.textContent=e.message);
  const token=new URLSearchParams(location.hash.slice(1)).get('token');
  if(token) history.replaceState(null,'',location.pathname);
  if(route==='xac-minh-email'){if(!token)msg.textContent='Liên kết không hợp lệ.';else api('auth/verify-email',{token}).then(r=>msg.textContent=r.message).catch(e=>msg.textContent=e.message)}
  root.querySelector('form')?.addEventListener('submit',async e=>{
    e.preventDefault();const form=e.currentTarget, action=form.dataset.action, fd=new FormData(form), data=Object.fromEntries(fd.entries());
    if(data.confirm!==undefined && data.confirm!==(data.new_password||data.password)){msg.textContent='Mật khẩu xác nhận không khớp.';return} delete data.confirm;
    if(action==='register')data.terms=fd.has('terms');if(action==='login')data.remember=fd.has('remember');if(action==='reset-password')data.token=token||'';
    const btn=form.querySelector('[type=submit],button.primary');btn.disabled=true;msg.textContent='Đang xử lý…';
    try{const result=await api(action==='profile'?'users/me':'auth/'+action,data,action==='profile'?'PATCH':'POST');if(action==='login'){const target=new URLSearchParams(location.search).get('next')||'';try{sessionStorage.setItem('phe_skip_intro','1');}catch(_){}location.href=/^\/xem-phim\/[a-z0-9-]+\/?$/.test(target)?target:'/';return}msg.textContent=result.message+(action==='register'&&!result.verification_email_sent?' Xác minh email chưa khả dụng.':'');if(action==='change-password')setTimeout(()=>location.href='/dang-nhap/',1800)}catch(err){msg.textContent=err.message}finally{btn.disabled=false}
  });
}
