export async function readBodyLimited(request:Request,limit:number):Promise<string|null>{
 const length=request.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>limit))return null;
 if(!request.body)return '';
 const reader=request.body.getReader(),parts:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();return null}parts.push(value)}
 const result=new Uint8Array(size);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.byteLength}
 return new TextDecoder().decode(result);
}
