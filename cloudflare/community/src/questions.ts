export type Movie={title:string;slug:string};
const normalize=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('vi').replace(/[\u200B-\u200F\uFEFF]/g,'').replace(/\s+/g,' ').trim();
export function isMovieQuestion(text:string):boolean{
 const value=normalize(text);
 return /(phim|tập|phần|diễn viên|đạo diễn|chiếu|ra mắt)/u.test(value)&&(/\?/.test(value)||/(bao nhiêu|bao giờ|khi nào|ai|nào|không|chưa|gì|mấy|còn|có)/u.test(value));
}
export function movieQuestion(text:string,recent:string[],movies:Movie[]):{slug:string|null}|null{
 const value=normalize(text);
 if(!isMovieQuestion(value))return null;
 const ordered=[...movies].sort((a,b)=>b.title.length-a.title.length);
 for(const item of [value,...recent.slice(-5).reverse().map(normalize)]){const found=ordered.find(m=>normalize(m.title)&&item.includes(normalize(m.title)));if(found)return {slug:found.slug}}
 if(/phim nào|phim gì|gợi ý|đề xuất|giới thiệu/u.test(value))return {slug:null};
 return null;
}
export function probabilityAllowed(probability:number,random:number):boolean{return Number.isFinite(probability)&&probability>=0&&probability<=1&&random>=0&&random<probability}
export function isBotMention(text:string):boolean{
 const norm=normalize(text);
 return /@(?:hung_?creater|hưng_?creater|hung|hưng|bot|ai)(?!\p{L})/u.test(norm)
   || /@(?:hung|hưng)\s*creater(?!\p{L})/u.test(norm)
   || /(?<!\p{L})(?:hưng|hung)\s*creater(?!\p{L})/u.test(norm)
   || /(?<!\p{L})(?:hưng|hung|bot|ai)\s*(?:ơi|oi)(?!\p{L})/u.test(norm)
   || /(?<!\p{L})(?:chào|alo|hỏi|gọi)\s+(?:hưng|bot|ai)(?!\p{L})/u.test(norm)
   || /(?<!\p{L})(?:hưng|bot)\s+(?:cho\s+hỏi|giúp|tư\s+vấn)(?!\p{L})/u.test(norm);
}
