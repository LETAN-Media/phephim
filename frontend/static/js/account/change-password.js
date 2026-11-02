import {request,setStatus} from './api.js';
import {currentUser} from './navigation.js';
const form=document.querySelector('#password-form'), button=form.querySelector('button[type=submit]'), status=form.querySelector('.form-status');
const fields=[form.elements.current_password,form.elements.new_password,form.elements.confirm];
let ready=false;
function validate(input){
  let error='';if(!input.value)error='Vui lòng điền thông tin này.';
  else if(input.name==='new_password' && input.value.length<10)error='Mật khẩu cần ít nhất 10 ký tự.';
  else if(input.name==='confirm' && input.value!==form.elements.new_password.value)error='Mật khẩu xác nhận chưa khớp.';
  const hint=document.getElementById(`${input.name}-error`);hint.textContent=error || (input.name==='new_password'?'Tối thiểu 10 ký tự.':'');hint.classList.toggle('error',!!error);input.setAttribute('aria-invalid',String(!!error));return !error;
}
fields.forEach(input=>{input.addEventListener('blur',()=>{if(input.value)validate(input);});input.addEventListener('input',()=>{if(input.getAttribute('aria-invalid')==='true')validate(input);if(input.name==='new_password' && form.elements.confirm.value)validate(form.elements.confirm);});});
document.querySelectorAll('.password-toggle-account').forEach(toggle=>toggle.addEventListener('click',()=>{const input=document.getElementById(toggle.getAttribute('aria-controls'));const visible=input.type==='password';input.type=visible?'text':'password';toggle.textContent=visible?'Ẩn':'Hiện';toggle.setAttribute('aria-pressed',String(visible));toggle.setAttribute('aria-label',`${visible?'Ẩn':'Hiện'} ${input.labels[0].textContent.toLowerCase()}`);}));
currentUser.then(()=>{ready=true;button.disabled=false;}).catch(error=>setStatus(status,error.status===401?'Vui lòng đăng nhập để đổi mật khẩu.':'Không thể tải tài khoản.','error'));
form.addEventListener('submit',async event=>{
  event.preventDefault();if(!ready)return;const valid=fields.map(validate).every(Boolean);if(!valid){fields.find(input=>input.getAttribute('aria-invalid')==='true')?.focus();return;}
  button.disabled=true;button.firstElementChild.textContent='Đang lưu…';setStatus(status,'');
  try{await request('/api/auth/change-password',{method:'POST',data:{current_password:fields[0].value,new_password:fields[1].value}});form.reset();ready=false;setStatus(status,'Đã đổi mật khẩu. Vui lòng đăng nhập lại.');const link=document.createElement('a');link.href='/dang-nhap/';link.textContent=' Đăng nhập';status.append(link);}
  catch(error){setStatus(status,error.message,'error');button.disabled=false;}
  finally{button.firstElementChild.textContent='Lưu mật khẩu';}
});
