export async function request(path, {method='GET', data}={}) {
  const headers={};
  if (data !== undefined) headers['Content-Type']='application/json';
  if (method !== 'GET') {
    const token=document.cookie.split('; ').find(item=>item.startsWith('__Host-phe_csrf='))?.slice('__Host-phe_csrf='.length);
    if (token) headers['X-CSRF-Token']=decodeURIComponent(token);
  }
  const response=await fetch(path,{method,headers,credentials:'same-origin',cache:'no-store',...(data !== undefined ? {body:JSON.stringify(data)} : {})});
  const body=await response.json().catch(()=>({}));
  if (!response.ok) { const error=new Error(typeof body.detail==='string' ? body.detail : 'Không thể xử lý yêu cầu. Vui lòng thử lại.'); error.status=response.status; throw error; }
  return body;
}
export function setStatus(node, text, kind='') { node.textContent=text; node.dataset.kind=kind; }
