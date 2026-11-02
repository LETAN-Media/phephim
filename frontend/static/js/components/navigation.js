document.querySelectorAll('.site-menu-toggle').forEach(button => {
  const menu = document.getElementById(button.getAttribute('aria-controls'));
  if (!menu) return;
  const setOpen = open => {
    menu.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Đóng menu' : 'Mở menu');
  };
  button.addEventListener('click', () => setOpen(button.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', event => { if (event.target.closest('a')) setOpen(false); });
  document.addEventListener('click', event => { if (!button.contains(event.target) && !menu.contains(event.target)) setOpen(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') { setOpen(false); button.focus(); } });
});
