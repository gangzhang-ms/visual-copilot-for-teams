export function validDemoChatId(value:unknown):value is string{
  return typeof value==="string"&&value.length>=1&&value.length<=64&&!/[^A-Za-z0-9_-]/.test(value);
}
export const demoRoomLifetimeMs=30*60_000;
export function demoRoomUrl(chatId:string){return `/chat?chatId=${encodeURIComponent(chatId)}`;}
export function scopedDemoMedia(key:string,value:unknown,chatId:string):unknown{
  return ["imageUrl","animationUrl","posterUrl","mediaUrl"].includes(key)&&typeof value==="string"
    &&/^\/local\/(?:assets|generated|memes)\//.test(value)
    ?`${value}?chatId=${encodeURIComponent(chatId)}`:value;
}
