import {classify} from './moderation';

/** Fail closed on claims whose dates, counts or release state cannot be verified. */
export function safeConversationAnswer(answer:string):string|null{
 const text=answer.trim();
 if(!text||text.length>1200||classify(text,[])==='url'||/<\/?[a-z]/i.test(text))return null;
 if(/(?<!\p{L}|\p{N})(?:\d+\s*tập|tập\s*\d+|tập\s+(?:tiếp|sau|mới|cuối)|phần\s+(?:tiếp|sau|mới|\d+)|mùa\s+(?:tiếp|sau|mới|\d+)|\blịch(?:\s+(?:chiếu|phát|ra)|$|[.,!?;:])|ra\s+mắt|sắp\s+chiếu|đã\s+kết\s+thúc|phát\s+hành|đang\s+chiếu|mới\s+nhất|(?:ngày|tháng|năm)\s+\d+|\d{1,2}[/-]\d{1,2}|tháng\s+(?:sau|tới|trước)|năm\s+(?:sau|tới|trước))(?!\p{L}|\p{N})/iu.test(text))return null;
 return text;
}
export function verifiedMovieFacts(question:string,count:number,releaseAt:string|null,film?:{title:string;genre?:string}|null):string{
 const text=question.normalize('NFKC').toLocaleLowerCase('vi');const facts:string[]=[];
 if(/thể loại|thuộc loại|dòng phim/u.test(text)&&film?.genre)facts.push(`${film.title} thuộc thể loại ${film.genre}.`);
 if(/(?:bao nhiêu|mấy)/u.test(text)&&/tập/u.test(text)&&Number.isSafeInteger(count)&&count>=0)facts.push(`PHE PHIM AI hiện ghi nhận ${count} tập; chưa có tổng số tập được xác nhận.`);
 if(/(?:bao giờ|khi nào|lịch|sắp chiếu|ra mắt)/u.test(text)&&releaseAt){const date=new Date(releaseAt);if(Number.isFinite(date.getTime()))facts.push(`Lịch đã xác nhận: ${date.toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})} (giờ Việt Nam).`)}
 return facts.join(' ');
}
export function composeVerifiedReply(generated:string,verified:string,film?:{title:string;genre?:string}|null):string{
 if(!verified)return generated;
 if(!film)return `${generated} ${verified}`;
 const title=film.title.toLocaleLowerCase('vi'),genre=film.genre?.toLocaleLowerCase('vi');
 const prefix=generated.split(/(?<=[.!?])\s+/u).filter(part=>{
  const lower=part.toLocaleLowerCase('vi');return !lower.includes(title)&&(!genre||!lower.includes(genre));
 }).join(' ').trim();
 return prefix?`${prefix} ${verified}`:verified;
}
