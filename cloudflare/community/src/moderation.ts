export type Violation='url'|'language'|'advertising'|'solicitation'|'spam';
export type ModerationOptions={antiAds?:boolean;antiSolicitation?:boolean;antiSpam?:boolean;advertisingRules?:string[]};
export const normalize=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('vi').replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g,'').replace(/\s+/g,' ').trim();
export function spamFingerprint(s:string):string{return normalize(s).replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim().slice(0,512)}
const platform=/(?:telegram|zalo|facebook|messenger|discord|whatsapp|tiktok|youtube|instagram|fb|tele\s*gram|za\s*lo)/iu;
const platformNames=['telegram','zalo','facebook','messenger','discord','whatsapp','tiktok'];
const group=/(?:nhóm|kênh|group|server|cộng\s*đồng)/iu;
const invitation=/(?:\b(?:inbox|ib|dm)\b|nhắn\s*(?:riêng|tin|mình|mẹo)|liên\s*hệ|kết\s*bạn|tham\s*gia|truy\s*cập|(?:vào|qua|sang|ghé|join)\s*(?:nhóm|kênh|group|server|facebook|fb|telegram|zalo|discord|tiktok|messenger|whatsapp)|(?:vào|qua|sang)\s+(?:bên\s+)?(?:mình|tôi|tớ))/iu;
const product=/(?:tài\s*khoản|gói\s*(?:vip|xem|cước)|vip|dịch\s*vụ|khóa\s*học|phần\s*mềm|công\s*cụ|vé\s*(?:xem\s*)?phim)/iu;
const seller=/(?:bán|rao\s*bán|mở\s*bán|mời\s*mua|nhận\s*xem|cung\s*cấp)/iu;
const commercialPrompt=/(?:liên\s*hệ|nhắn\s*(?:tin|mình|riêng)|inbox|đăng\s*ký\s*(?:ngay|với\s*mình)|giá\s*(?:rẻ|tốt|chỉ|từ|cực))/iu;
const url=/https?\s*:\s*\/\s*\/|www\s*\.|(?:^|[^\p{L}\p{N}@-])(?:[a-z0-9-]+\s*(?:\.|\[\s*(?:dot|\.)\s*\]|\(\s*(?:dot|\.)\s*\))\s*)+(?:com|net|org|vn|io|ai|co|me|tv|app|dev|info|xyz|site|online|link|ly|gg|to|cc|ru|uk|us)(?![\p{L}\p{N}-])/iu;
function escapedRule(raw:string):RegExp|null{const phrase=normalize(raw);if(!phrase)return null;const encoded=phrase.split(' ').map(word=>Array.from(word).map(c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[\\W_]*')).join('[\\W_]+');return new RegExp(`(?<![\\p{L}\\p{N}_])${encoded}(?![\\p{L}\\p{N}_])`,'iu')}
export function classify(body:string,rules:string[],options:ModerationOptions={}):Violation|null{
 const text=normalize(body);const splitDomain=/(?<![\p{L}\p{N}@])(?:[a-z0-9]\s*){3,40}\s*(?:\.|\[\s*\.\s*\])\s*(?:c\s*o\s*m|n\s*e\s*t|o\s*r\s*g|v\s*n)(?![\p{L}\p{N}])/iu;
 if(url.test(text)||splitDomain.test(text))return 'url';
 for(const phrase of rules){if(escapedRule(phrase)?.test(text))return 'language'}
 if(options.antiAds!==false){
  const custom=(options.advertisingRules||[]).some(rule=>escapedRule(rule)?.test(text));
  const filmOffer=/(?:nhóm|kênh|bên)\s*(?:mình|tôi|tớ).{0,60}(?:full|link|xem\s*phim).{0,60}(?:ai\s*cần|nhắn|inbox|liên\s*hệ)/iu.test(text);
  const commercial=(seller.test(text)&&(product.test(text)||commercialPrompt.test(text)))||(product.test(text)&&/(?:giá\s*rẻ|giá\s*tốt|ưu\s*đãi|khuyến\s*mãi)/iu.test(text)&&/(?:liên\s*hệ|nhắn\s*(?:tin|mình|riêng)|inbox)/iu.test(text));
  if(custom||commercial||filmOffer)return 'advertising';
 }
 if(options.antiSolicitation!==false){
  const namedPlatform=platform.test(text)||platformNames.some(name=>escapedRule(name)?.test(text));
  const movement=/(?:^|[^\p{L}\p{N}])(?:qua|sang|vào|tham\s*gia|join)\s+/iu.test(text);
  const explicit=namedPlatform&&(invitation.test(text)||movement);
  const contact=/(?:@\s*[a-z0-9_][a-z0-9_.]{2,}|(?:\+?\d[\s.()-]*){9,13})/iu.test(text)&&invitation.test(text)&&/(?:phim|nhóm|kênh|full|link)/iu.test(text);
  const channelPromotion=invitation.test(text)&&group.test(text)&&/(?:của\s*(?:mình|tôi|tớ)|mình\s*có|có\s*nhiều\s*phim|lấy\s*phim|gửi\s*link)/iu.test(text);
  if(explicit||channelPromotion||contact)return 'solicitation';
 }
 if(options.antiSpam!==false){
  if(/(\S)\1{15,}/u.test(text))return 'spam';
  const words=text.split(/\s+/u);if(words.length>=8&&words.every(word=>word===words[0]))return 'spam';
 }
 return null;
}
export function classifyWithContext(body:string,recent:string[],rules:string[],options:ModerationOptions={}):Violation|null{
 const direct=classify(body,rules,options);if(direct)return direct;
 if(options.antiAds===false&&options.antiSolicitation===false)return null;
 const parts=[...recent.slice(-2),body].filter(Boolean);if(parts.length<2||parts.some(x=>x.length>150))return null;
 const combined=classify(parts.join(' '),[],{...options,antiSpam:false});
 return combined==='advertising'||combined==='solicitation'?combined:null;
}
