let dashLoad;
function load(){return new Promise((resolve,reject)=>{const node=document.createElement('script');const timeout=setTimeout(()=>{node.remove();reject(new Error('Không tải được trình phát DASH.'));},10000);node.src='/static/js/vendor/dash-5.2.1.min.js';node.onload=()=>{clearTimeout(timeout);resolve();};node.onerror=()=>{clearTimeout(timeout);reject(new Error('Không tải được trình phát DASH.'));};document.head.append(node);});}
export async function attachDash(video,url,{onLevels,onFatal}){
  dashLoad ||= load().catch(error=>{dashLoad=null;throw error;});await dashLoad;
  if(!window.dashjs?.MediaPlayer || !window.MediaSource)throw new Error('Trình duyệt này không hỗ trợ DASH.');
  const player=window.dashjs.MediaPlayer().create();
  const errors=window.dashjs.MediaPlayer.errors;
  const unrecoverable=new Set([
    errors.MANIFEST_LOADER_LOADING_FAILURE_ERROR_CODE,
    errors.MANIFEST_LOADER_PARSING_FAILURE_ERROR_CODE,
    errors.CAPABILITY_MEDIASOURCE_ERROR_CODE,
    errors.FRAGMENT_LOADER_LOADING_FAILURE_ERROR_CODE,
    errors.SEGMENT_BASE_LOADER_ERROR_CODE,
    errors.URL_RESOLUTION_FAILED_GENERIC_ERROR_CODE,
    errors.DATA_UPDATE_FAILED_ERROR_CODE,
    errors.APPEND_ERROR_CODE,
    errors.DOWNLOAD_ERROR_ID_MANIFEST_CODE,
    errors.DOWNLOAD_ERROR_ID_SIDX_CODE,
    errors.DOWNLOAD_ERROR_ID_CONTENT_CODE,
    errors.DOWNLOAD_ERROR_ID_INITIALIZATION_CODE,
    errors.MANIFEST_ERROR_ID_PARSE_CODE,
    errors.MANIFEST_ERROR_ID_NOSTREAMS_CODE,
    errors.MANIFEST_ERROR_ID_MULTIPLEXED_CODE,
    errors.MEDIASOURCE_TYPE_UNSUPPORTED_CODE
  ].filter(value=>value!==undefined));
  player.on(window.dashjs.MediaPlayer.events.STREAM_INITIALIZED,()=>{const levels=player.getRepresentationsByType('video')||[];onLevels(levels.map((item,index)=>({value:String(index),label:item.height?`${item.height}p`:`${Math.round((item.bandwidth||0)/1000)} kbps`})))});
  player.on(window.dashjs.MediaPlayer.events.ERROR,event=>{if(unrecoverable.has(event?.error?.code))onFatal();});
  player.initialize(video,url,false);
  return {destroy(){player.reset();},setQuality(value){player.updateSettings({streaming:{abr:{autoSwitchBitrate:{video:value==='auto'}}}});if(value!=='auto')player.setRepresentationForTypeByIndex('video',Number(value));}};
}
