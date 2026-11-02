const form = document.querySelector('form[data-action]');
const message = document.querySelector('.message');
const submit = form.querySelector('.submit');
const submitLabel = submit.querySelector('.submit-label');
const originalLabel = submitLabel.textContent;
const fields = [...form.querySelectorAll('input')];

function errorFor(input) {
  const isPassword = input.name === 'password' || input.name === 'confirm';
  const value = isPassword ? input.value : input.value.trim();
  if (input.type === 'checkbox') return input.required && !input.checked ? 'Vui lòng đồng ý với điều khoản sử dụng.' : '';
  if (!value) return 'Vui lòng điền thông tin này.';
  if (input.name === 'username' && !/^[A-Za-z0-9_]{3,32}$/.test(value)) return 'Tên cần 3–32 ký tự: chữ, số hoặc _.';
  if (input.type === 'email' && input.validity.typeMismatch) return 'Vui lòng nhập địa chỉ email hợp lệ.';
  if (isPassword && form.dataset.action === 'register' && input.value.length < 10) return 'Mật khẩu cần ít nhất 10 ký tự.';
  if (input.name === 'confirm' && input.value !== form.elements.password.value) return 'Mật khẩu xác nhận chưa khớp.';
  return '';
}
function validate(input) {
  const error = errorFor(input);
  const target = document.getElementById(`${input.name}-error`);
  if (target) target.textContent = error;
  input.setAttribute('aria-invalid', String(Boolean(error)));
  return !error;
}
fields.forEach(input => {
  input.addEventListener('blur', () => { if (input.value || input.type === 'checkbox') validate(input); });
  input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid') === 'true') validate(input);
    if (input.name === 'password' && form.elements.confirm?.value) validate(form.elements.confirm);
  });
});
document.querySelectorAll('.password-toggle').forEach(button => button.addEventListener('click', () => {
  const input = document.getElementById(button.getAttribute('aria-controls'));
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  button.textContent = visible ? 'Ẩn' : 'Hiện';
  button.setAttribute('aria-pressed', String(visible));
  button.setAttribute('aria-label', `${visible ? 'Ẩn' : 'Hiện'} ${input.name === 'confirm' ? 'xác nhận mật khẩu' : 'mật khẩu'}`);
}));
form.addEventListener('submit', async event => {
  event.preventDefault();
  const valid = fields.map(validate).every(Boolean);
  if (!valid) { message.textContent = ''; fields.find(input => input.getAttribute('aria-invalid') === 'true')?.focus(); return; }
  const data = Object.fromEntries(new FormData(form));
  delete data.confirm;
  if (form.dataset.action === 'register') data.terms = form.elements.terms.checked;
  else data.remember = form.elements.remember.checked;
  message.textContent = ''; message.removeAttribute('data-kind');
  submit.disabled = true; submitLabel.textContent = 'Đang xử lý…'; form.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(`/api/auth/${form.dataset.action}`, {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)});
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Không thể xử lý yêu cầu. Vui lòng thử lại.');
    if (form.dataset.action === 'login') {
      const target = new URLSearchParams(location.search).get('next') || '';
      const match = target.match(/^\/xem-phim\/[a-z0-9-]+\/?(?:\?episode=[A-Za-z0-9_-]{1,64})?$/);
      location.href = match ? target : '/';
      return;
    }
    message.dataset.kind = 'success';
    message.textContent = result.verification_email_sent ? 'Tạo tài khoản thành công. Vui lòng kiểm tra email để xác minh.' : 'Tạo tài khoản thành công. Xác minh email hiện chưa khả dụng; bạn vẫn có thể đăng nhập.';
  } catch (error) {
    message.dataset.kind = 'error';
    message.textContent = error.message || 'Không thể kết nối. Vui lòng thử lại.';
  } finally {
    submit.disabled = false; submitLabel.textContent = originalLabel; form.removeAttribute('aria-busy');
  }
});
