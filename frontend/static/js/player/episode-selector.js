export function episodeSelector(episodes, initial, onSelect, {series=false, unavailable=false}={}) {
  const panel=document.querySelector('#episode-panel');
  const list=document.querySelector('#episode-list');
  const count=document.querySelector('#episode-count');
  panel.setAttribute('aria-busy','false');
  if(!episodes.length){
    list.replaceChildren();
    const button=document.createElement('button');
    button.type='button';
    button.textContent=series || unavailable ? 'Tập 1' : 'Full';
    button.disabled=true;
    if(!series && !unavailable)button.setAttribute('aria-current','true');
    count.textContent=unavailable ? 'Chưa tải được danh sách tập' : series ? 'Tập mẫu · chưa có dữ liệu' : '1 tập';
    list.append(button);
    return {set(){}};
  }
  count.textContent=`${episodes.length} tập`;
  function set(selected){
    list.replaceChildren();
    episodes.forEach((episode,index)=>{
      const button=document.createElement('button');
      button.type='button';
      button.textContent=episode.title || `Tập ${index+1}`;
      if(episode.episode_key===selected)button.setAttribute('aria-current','true');
      button.addEventListener('click',()=>{if(episode.episode_key!==selected)onSelect(episode.episode_key);});
      list.append(button);
    });
  }
  set(initial);
  return {set};
}
