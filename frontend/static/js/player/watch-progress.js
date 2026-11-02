function csrf(){const item=document.cookie.split('; ').find(value=>value.startsWith('__Host-phe_csrf='));return item?decodeURIComponent(item.slice('__Host-phe_csrf='.length)):'';}
export function progressTracker(video,slug,episode,onError){
  let last=0,live=true;
  const query=episode?'?episode='+encodeURIComponent(episode):'';
  async function read(){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);try{const response=await fetch(`/api/users/me/watch-progress/${encodeURIComponent(slug)}${query}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('Không thể tải tiến độ xem.');return await response.json();}finally{clearTimeout(timer);}}
  function save(){if(!live||!Number.isFinite(video.currentTime)||video.currentTime<0)return;const token=csrf();if(!token){onError('Không thể lưu tiến độ. Vui lòng đăng nhập lại.');return;}const position=video.ended?0:Math.min(video.currentTime,604800);last=Date.now();fetch('/api/users/me/watch-progress',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify({movie_slug:slug,episode,position_seconds:position})}).then(r=>{if(!r.ok)onError('Không thể lưu tiến độ. Vui lòng thử lại.');}).catch(()=>onError('Không thể lưu tiến độ. Vui lòng thử lại.'));}
  function tick(){if(!video.paused&&Date.now()-last>15000)save();}
  function pause(){if(video.currentTime>0)save();}
  function hidden(){if(document.visibilityState==='hidden'&&video.currentTime>0)save();}
  video.addEventListener('timeupdate',tick);video.addEventListener('pause',pause);video.addEventListener('ended',save);document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',pause);
  return {read,save,destroy(){live=false;video.removeEventListener('timeupdate',tick);video.removeEventListener('pause',pause);video.removeEventListener('ended',save);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',pause);}};
}
