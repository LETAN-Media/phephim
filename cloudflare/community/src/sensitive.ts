export function containsSensitive(value:string):boolean{
 return /(?:\b(?:ghp|gho|ghu|ghs|ghr|cfat)_[a-z0-9]{20,}\b|\bsk-[a-z0-9_-]{20,}\b|\bbearer\s+[a-z0-9._~+\/-]{20,}|__Host-phe_(?:session|csrf)\s*=|\b(?:api[_-]?key|access[_-]?token|password|mật\s*khẩu)\s*[:=]\s*\S{8,})/iu.test(value);
}
