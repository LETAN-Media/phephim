export interface CooldownState {total:number;lastRoom:number|null;lastUser:number|null}
export interface CooldownLimits {roomSeconds:number;userSeconds:number;maxPerHour:number}
export function cooldownAllows(state:CooldownState,limits:CooldownLimits,now:number):boolean{
 if(!Number.isFinite(now)||!Number.isFinite(limits.roomSeconds)||!Number.isFinite(limits.userSeconds)||!Number.isInteger(limits.maxPerHour)||limits.roomSeconds<0||limits.userSeconds<0||limits.maxPerHour<1)return false;
 if(state.total>=limits.maxPerHour)return false;
 if(state.lastRoom!==null&&now-state.lastRoom<limits.roomSeconds*1000)return false;
 if(state.lastUser!==null&&now-state.lastUser<limits.userSeconds*1000)return false;
 return true;
}
