export function connectRealtime(room, onEvent, onStatus, type="community"){
 let socket,timer,heartbeat,polling,closed=false,attempt=0,everConnected=false;
 function startPolling(){
  if(closed||polling)return;
  onStatus('Đang cập nhật');onEvent({type:'refresh'});
  polling=setInterval(()=>{if(!document.hidden)onEvent({type:'refresh'})},3000);
 }
 function connect(){
  if(closed)return;onStatus('Đang kết nối');socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws/${type==='support'?'support':'community'}/${encodeURIComponent(room)}`);
  socket.onopen=()=>{attempt=0;everConnected=true;onStatus('Đã kết nối');onEvent({type:'refresh'});heartbeat=setInterval(()=>{if(socket.readyState===WebSocket.OPEN)socket.send('ping')},20000)};
  socket.onmessage=event=>{if(event.data==='pong')return;try{onEvent(JSON.parse(event.data))}catch{}};
  socket.onclose=event=>{clearInterval(heartbeat);if(closed)return;if(event.code===1008){onStatus('Phiên đã hết hạn');return}if(!everConnected&&attempt>=1){startPolling();return}onStatus('Đang kết nối lại');const delay=Math.min(30000,1000*2**attempt++)+Math.random()*500;timer=setTimeout(connect,delay)};
  socket.onerror=()=>socket.close();
 }
 connect();return ()=>{closed=true;clearTimeout(timer);clearInterval(heartbeat);clearInterval(polling);socket?.close()};
}
