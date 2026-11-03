const root=document.querySelector('#pinned-messages');
export function renderPins(pins){
 root.hidden=!pins.length;root.replaceChildren();if(!pins.length)return;
 const details=document.createElement('details');const summary=document.createElement('summary');const heading=document.createElement('span');heading.className='community-pin-summary-text';const title=document.createElement('span');title.className='community-pin-title';title.textContent=`Thông báo từ Hưng Creater${pins.length>1?` (${pins.length})`:''}`;const preview=document.createElement('span');preview.className='community-pin-preview';preview.textContent=pins[0].body;heading.append(title,preview);summary.append(heading);details.append(summary);
 pins.forEach(pin=>{
  const text=document.createElement('p');let previous=0;
  for(const match of pin.body.matchAll(/\/phim\/[a-z0-9-]+\//g)){
   text.append(document.createTextNode(pin.body.slice(previous,match.index)));
   const link=document.createElement('a');link.href=match[0];link.textContent='Xem thông tin phim';text.append(link);previous=match.index+match[0].length;
  }
  text.append(document.createTextNode(pin.body.slice(previous)));details.append(text);
 });
 root.append(details);
}
