import {request,setStatus} from './api.js';
import {currentUser,displayUser} from './navigation.js';
const form=document.querySelector('#profile-form');
const username=form.elements.username, email=form.elements.email, button=form.querySelector('button[type=submit]'), hint=document.querySelector('#username-error'), status=form.querySelector('.form-status');
const defaultHint='3–32 ký tự: chữ, số hoặc dấu gạch dưới.';
let user;
function validate(){const valid=/^[A-Za-z0-9_]{3,32}$/.test(username.value.trim());hint.textContent=valid?defaultHint:'Tên cần 3–32 ký tự: chữ, số hoặc _.';hint.classList.toggle('error',!valid);username.setAttribute('aria-invalid',String(!valid));return valid;}
username.addEventListener('blur',()=>{if(username.value)validate();});
username.addEventListener('input',()=>{if(username.getAttribute('aria-invalid')==='true')validate();});
currentUser.then(value=>{user=value;username.value=user.username;email.value=user.email;button.disabled=false;}).catch(error=>setStatus(status,error.status===401?'Vui lòng đăng nhập để chỉnh sửa hồ sơ.':'Không thể tải thông tin hồ sơ.','error'));
form.addEventListener('submit',async event=>{
  event.preventDefault();if(!user || !validate()){username.focus();return;}
  button.disabled=true;button.firstElementChild.textContent='Đang lưu…';setStatus(status,'');
  try{await request('/api/users/me',{method:'PATCH',data:{username:username.value.trim()}});user={...user,username:username.value.trim()};username.value=user.username;displayUser(user);setStatus(status,'Đã lưu thông tin hồ sơ.');}
  catch(error){setStatus(status,error.message,'error');}
  finally{button.disabled=false;button.firstElementChild.textContent='Lưu thông tin';}
});
