import type {Env} from './env';
export type Movie={slug:string;title:string;genre?:string;year?:number;status?:string};
export async function getCatalog(env:Env):Promise<Movie[]>{
 const source=env.CATALOG_ORIGIN||env.APP_ORIGIN;const origin=new URL(source);if(origin.protocol!=='https:'||origin.origin!==source)throw new Error('Invalid origin');
 const response=await fetch(new URL('/api/movies',origin),{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(7000)});
 if(!response.ok)throw new Error('Catalog unavailable');
 const data=await response.json() as {movies?:unknown};if(!Array.isArray(data.movies)||!data.movies.length||data.movies.length>10000)throw new Error('Catalog invalid');
 const entries=data.movies.map(x=>{
  if(!x||typeof x!=='object')throw new Error('Catalog invalid');const item=x as Record<string,unknown>;
  if(typeof item.slug!=='string'||!/^[a-z0-9-]{1,128}$/.test(item.slug)||typeof item.title!=='string'||!item.title.trim()||item.title.length>200)throw new Error('Catalog invalid');
  return {slug:item.slug,title:item.title,genre:typeof item.genre==='string'?item.genre.slice(0,150):undefined,year:typeof item.year==='number'?item.year:undefined,status:typeof item.status==='string'?item.status.slice(0,100):undefined};
 });
 if(new Set(entries.map(x=>x.slug)).size!==entries.length)throw new Error('Catalog invalid');
 return entries;
}
