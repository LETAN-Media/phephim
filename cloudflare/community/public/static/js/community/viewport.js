const viewport=window.visualViewport;
function update(){if(!viewport)return;document.documentElement.style.setProperty('--community-viewport-height',`${viewport.height}px`);document.documentElement.style.setProperty('--community-viewport-top',`${viewport.offsetTop}px`)}
viewport?.addEventListener('resize',update,{passive:true});viewport?.addEventListener('scroll',update,{passive:true});update();
const input=document.querySelector('#chat-input');input.addEventListener('input',()=>{input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,120)}px`});
