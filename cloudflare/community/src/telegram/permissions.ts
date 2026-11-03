export function isAdmin(id:unknown,configured:string|undefined):boolean{
 if(typeof id!=='number'||!Number.isSafeInteger(id)||id<=0||!configured)return false;
 const parts=configured.split(',').map(x=>x.trim());if(parts.some(x=>!/^\d+$/.test(x)))return false;
 return parts.some(x=>Number(x)===id);
}
export function equalSecret(a:string,b:string):boolean{
 const encoder=new TextEncoder(),left=encoder.encode(a),right=encoder.encode(b);
 let diff=left.length^right.length;const n=Math.max(left.length,right.length);
 for(let i=0;i<n;i++)diff|=(left[i%Math.max(1,left.length)]||0)^(right[i%Math.max(1,right.length)]||0);
 return !!a&&!!b&&diff===0;
}
