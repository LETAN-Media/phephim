let hlsLoad;
function script(src){return new Promise((resolve,reject)=>{const node=document.createElement('script');const timeout=setTimeout(()=>{node.remove();reject(new Error('Không tải được trình phát HLS.'));},10000);node.src=src;node.onload=()=>{clearTimeout(timeout);resolve();};node.onerror=()=>{clearTimeout(timeout);reject(new Error('Không tải được trình phát HLS.'));};document.head.append(node);});}
export async function attachHls(video,url,{onLevels,onFatal}){
  const support=video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegURL');
  const nativeHls=Boolean(support);
  // Native WebKit playback avoids unnecessary MSE on iOS; other MSE browsers
  // can use hls.js for adaptive quality selection even if they report "maybe".
  if(nativeHls && (support==='probably' || typeof video.webkitEnterFullscreen==='function' || navigator.vendor==='Apple Computer, Inc.')){
    video.src=url;video.load();return {destroy(){},setQuality(){}};
  }
  hlsLoad ||= script('/static/js/vendor/hls-1.7.4.min.js').catch(error=>{hlsLoad=null;throw error;});
  await hlsLoad;
  if(!window.Hls?.isSupported()){
    if(nativeHls){video.src=url;video.load();return {destroy(){},setQuality(){}};}
    throw new Error('Trình duyệt này không hỗ trợ HLS.');
  }
  const hls=new window.Hls();
  hls.on(window.Hls.Events.MANIFEST_PARSED,()=>onLevels(hls.levels.map((level,index)=>({value:String(index),label:level.height?`${level.height}p`:`${Math.round(level.bitrate/1000)} kbps`}))));
  hls.on(window.Hls.Events.ERROR,(_event,data)=>{if(data.fatal)onFatal(data.type===window.Hls.ErrorTypes.NETWORK_ERROR?'Không tải được playlist hoặc phân đoạn HLS. Kiểm tra mạng và CORS.':'Không giải mã được luồng HLS. Kiểm tra codec hoặc thử nguồn khác.');});
  hls.loadSource(url);hls.attachMedia(video);
  return {destroy(){hls.destroy();},setQuality(value){hls.currentLevel=value==='auto'?-1:Number(value);}};
}
