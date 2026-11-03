import {describe,it,expect} from 'vitest';
import {classify} from '../src/moderation';
import {movieQuestion,probabilityAllowed} from '../src/questions';
import {cooldownAllows} from '../src/cooldown';

describe('community moderation',()=>{
 it('detects links and normalized profanity without blocking ordinary words',()=>{
  for(const text of ['https://example.com','example [dot] com','l.ồ.n','ĐỤ MÁ'])expect(classify(text,['lồn','đụ má'])).not.toBeNull();
  for(const text of ['Tôi bị kẹt xe','Phim này rất hay'])expect(classify(text,['lồn','đụ má','con kẹt'])).toBeNull();
 });
});
describe('film question gating',()=>{
 const movies=[{title:'Parasite',slug:'parasite'}];
 it('uses only a matching title from bounded recent history',()=>{
  expect(movieQuestion('Phim này có bao nhiêu tập?',['Đang xem Parasite'],movies)).toEqual({slug:'parasite'});
  expect(movieQuestion('Phim này có bao nhiêu tập?',[],movies)).toBeNull();
  expect(movieQuestion('Hôm nay ăn gì?',[],movies)).toBeNull();
 });
 it('respects probability boundaries',()=>{expect(probabilityAllowed(.3,.299)).toBe(true);expect(probabilityAllowed(.3,.3)).toBe(false)});
});
describe('durable cooldown logic',()=>{
 const limits={roomSeconds:120,userSeconds:600,maxPerHour:12};const now=1_000_000;
 it('enforces per-room, per-user and hourly limits',()=>{
  expect(cooldownAllows({total:0,lastRoom:null,lastUser:null},limits,now)).toBe(true);
  expect(cooldownAllows({total:1,lastRoom:now-119000,lastUser:null},limits,now)).toBe(false);
  expect(cooldownAllows({total:1,lastRoom:null,lastUser:now-599000},limits,now)).toBe(false);
  expect(cooldownAllows({total:12,lastRoom:null,lastUser:null},limits,now)).toBe(false);
  expect(cooldownAllows({total:1,lastRoom:now-120000,lastUser:now-600000},limits,now)).toBe(true);
 });
});
import {isAdmin,equalSecret} from '../src/telegram/permissions';
describe('Telegram permissions',()=>{
 it('matches only numeric sender IDs',()=>{expect(isAdmin(123,'123,456')).toBe(true);expect(isAdmin('123','123')).toBe(false);expect(isAdmin(123,'123,bad')).toBe(false)});
 it('rejects missing or incorrect webhook secrets',()=>{expect(equalSecret('secret','secret')).toBe(true);expect(equalSecret('secret','wrong')).toBe(false);expect(equalSecret('','')).toBe(false)});
});
import {getCatalog} from '../src/catalog';
import type {Env} from '../src/env';
describe('authoritative movie catalog',()=>{
 it('rejects malformed and cross-origin catalogue data',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({movies:[{slug:'../evil',title:'Bad'}]}),{headers:{'Content-Type':'application/json'}});
  try{await expect(getCatalog({APP_ORIGIN:'https://example.test'} as Env)).rejects.toThrow();await expect(getCatalog({APP_ORIGIN:'https://example.test/path'} as Env)).rejects.toThrow()}
  finally{globalThis.fetch=original}
 });
 it('returns only safe movie metadata',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({movies:[{slug:'parasite',title:'Parasite',genre:'Drama',secret:'discard'}]}),{headers:{'Content-Type':'application/json'}});
  try{const result=await getCatalog({APP_ORIGIN:'https://example.test'} as Env);expect(result[0].slug).toBe('parasite');expect(result[0]).not.toHaveProperty('secret')}
  finally{globalThis.fetch=original}
 });
});
import {safeConversationAnswer} from '../src/ai-response';
describe('AI fact safety',()=>{
 it('rejects unsupported episode counts, dates and URLs',()=>{
  for(const text of ['Có 12 tập','Sẽ ra mắt vào tháng sau','Đã kết thúc','Xem example.com','<script>x</script>'])expect(safeConversationAnswer(text)).toBeNull();
  expect(safeConversationAnswer('Bạn có thể tìm hiểu Parasite nhé.')).toBeTruthy();
  expect(safeConversationAnswer('Bộ phim tập trung vào hành trình của nhân vật.')).toBeTruthy();
  expect(safeConversationAnswer('Bạn nên xem tập tiếp theo.')).toBeNull();
 });
});
import {verifiedMovieFacts} from '../src/ai-response';
describe('verified movie facts',()=>{
 it('distinguishes the available episode count from an unconfirmed total',()=>{
  const fact=verifiedMovieFacts('Phim này có bao nhiêu tập?',3,null);
  expect(fact).toContain('hiện ghi nhận 3 tập');expect(fact).toContain('chưa có tổng số tập');
 });
 it('does not invent a release date',()=>{expect(verifiedMovieFacts('Bao giờ có tập tiếp?',0,null)).toBe('')});
});
import {containsSensitive} from '../src/sensitive';
describe('secret filtering',()=>{
 it('recognizes common credential formats without flagging ordinary chat',()=>{
  expect(containsSensitive('Bearer '+ 'a'.repeat(30))).toBe(true);
  expect(containsSensitive('api_key='+ 'x'.repeat(24))).toBe(true);
  expect(containsSensitive('Phim này hay không?')).toBe(false);
 });
});
it('applies the configured 30% boundary over deterministic draws',()=>{
 let count=0;for(let n=0;n<10000;n++)if(probabilityAllowed(.30,n/10000))count++;
 expect(count).toBe(3000);
});
it('grounds genre in the actual catalog, not generated text',()=>{
 expect(verifiedMovieFacts('Interstellar thuộc thể loại gì?',0,null,{title:'Interstellar',genre:'Khoa học viễn tưởng'})).toBe('Interstellar thuộc thể loại Khoa học viễn tưởng.');
});
import {composeVerifiedReply} from '../src/ai-response';
it('does not repeat a generated fact when appending verified catalog data',()=>{
 const film={title:'Interstellar',genre:'Khoa học viễn tưởng'};
 const fact='Interstellar thuộc thể loại Khoa học viễn tưởng.';
 expect(composeVerifiedReply('Phim Interstellar thuộc thể loại Khoa học viễn tưởng.',fact,film)).toBe(fact);
 expect(composeVerifiedReply('Mình đã kiểm tra nhé. Phim Interstellar thuộc thể loại Khoa học viễn tưởng.',fact,film)).toBe('Mình đã kiểm tra nhé. '+fact);
});
import {classifyWithContext,spamFingerprint} from '../src/moderation';
describe('ads and solicitation',()=>{
 it('blocks clear promotions and invitations',()=>{
  for(const message of ['Nhận xem phim VIP giá rẻ, liên hệ mình.','Nhóm mình có full phim, ai cần thì nhắn riêng.','Bên mình bán tài khoản xem phim, giá cực tốt.','Qua Telegram mình gửi link phim cho.','Vào nhóm Zalo của mình nhé.','Ai muốn xem full thì inbox Facebook.','Tham gia Discord của mình để lấy phim.','Qua kênh của mình có nhiều phim hay hơn.'])expect(classify(message,[]),message).not.toBeNull();
 });
 it('allows ordinary discussion of platforms and brands',()=>{
  for(const message of ['Tôi xem trailer trên YouTube.','Phim này đang nổi trên TikTok.','Tôi thấy mọi người bàn phim này trên Facebook.','Tôi dùng Telegram để xem thông báo.','Mình thích thương hiệu phim này.'])expect(classify(message,[]),message).toBeNull();
 });
 it('detects split solicitation and normalizes invisible characters',()=>{
  expect(classifyWithContext('mình gửi link phim cho',['Qua Tele\u200bgram'],[])).toBe('solicitation');
  expect(spamFingerprint('  PHIM\u200b hay!!! ')).toBe('phim hay');
 });
 it('handles explicit repeated noise conservatively',()=>{
  expect(classify('aaaaaaaaaaaaaaaaaaaa',[])).toBe('spam');
  expect(classify('hay hay hay',[])).toBeNull();
 });
});
it('handles separated platform names and domain evasions without banning neutral mentions',()=>{
 expect(classify('Qua t.e.l.e.g.r.a.m mình gửi phim cho',[])).toBe('solicitation');
 expect(classify('xem tại e x a m p l e . c o m',[])).toBe('url');
 expect(classify('Tôi xem trailer trên T.e.l.e.g.r.a.m',[])).toBeNull();
});
it('does not punish non-promotional discussion of prices or services',()=>{
 for(const text of ['Tôi mua gói VIP giá rẻ hôm qua.','Tôi đang đánh giá dịch vụ xem phim.','Mình thích tài khoản của nhân vật này.'])expect(classify(text,[]),text).toBeNull();
});
import {effectivePolicy} from '../src/moderation-policy';
it('enforces the stricter of deployment and administrator rate limits',()=>{
 const policy=effectivePolicy({COMMUNITY_MAX_MESSAGES_10S:'5',COMMUNITY_MAX_MESSAGES_60S:'20',COMMUNITY_ANTI_ADS_ENABLED:'false'} as Env,{max_messages_10s:3,max_messages_60s:40});
 expect(policy.max10).toBe(3);expect(policy.max60).toBe(20);expect(policy.antiAds).toBe(false);
});
it('fails closed if configured warning or ban policy differs from the required 3/24',()=>{
 expect(effectivePolicy({COMMUNITY_MODERATION_MAX_WARNINGS:'4'} as Env,{}).valid).toBe(false);
 expect(effectivePolicy({COMMUNITY_MODERATION_BAN_HOURS:'12'} as Env,{}).valid).toBe(false);
 expect(effectivePolicy({} as Env,{}).valid).toBe(true);
});
