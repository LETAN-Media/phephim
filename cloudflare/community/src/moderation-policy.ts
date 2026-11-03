import type {Env} from './env';
export type PolicyRow={anti_spam?:boolean;anti_ads?:boolean;block_solicitation?:boolean;max_messages_10s?:number;max_messages_60s?:number;duplicate_window_seconds?:number};
const enabled=(value:string|undefined)=>value?.toLowerCase()!=='false';
function bounded(value:string|undefined,def:number,min:number,max:number):number{if(value===undefined)return def;const n=Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:def}
export function effectivePolicy(env:Env,row:PolicyRow){
 return {
  valid:(env.COMMUNITY_MODERATION_MAX_WARNINGS??'3')==='3'&&(env.COMMUNITY_MODERATION_BAN_HOURS??'24')==='24',
  antiSpam:enabled(env.COMMUNITY_ANTI_SPAM_ENABLED)&&row.anti_spam!==false,
  antiAds:enabled(env.COMMUNITY_ANTI_ADS_ENABLED)&&row.anti_ads!==false,
  antiSolicitation:enabled(env.COMMUNITY_BLOCK_EXTERNAL_SOLICITATION)&&row.block_solicitation!==false,
  max10:Math.min(bounded(env.COMMUNITY_MAX_MESSAGES_10S,5,1,50),Number(row.max_messages_10s||5)),
  max60:Math.min(bounded(env.COMMUNITY_MAX_MESSAGES_60S,20,1,200),Number(row.max_messages_60s||20)),
  duplicateSeconds:Math.max(bounded(env.COMMUNITY_DUPLICATE_WINDOW_SECONDS,60,10,600),Number(row.duplicate_window_seconds||60))
 };
}
