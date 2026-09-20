const stop=new Set("a an the i me my we our you your it its is are was were be been to for of and or but with in on at by from this that please image picture create make generate would could should have has had 的 了 我 我们 你 你们 请 生成 图片".split(" "));
export function deriveWebSearchTerms(intent:string):string{
  const publicText=intent.replace(/https?:\/\/\S+|\S+@\S+\.\S+/giu," ");
  const selected:string[]=[];
  for(const part of new Intl.Segmenter(undefined,{granularity:"word"}).segment(publicText)){
    if(!part.isWordLike||stop.has(part.segment.toLowerCase())||selected.includes(part.segment))continue;
    if(selected.length===8||[...selected.join(" ")+part.segment].length>80)break;
    selected.push(part.segment);
  }
  return selected.join(" ");
}
export function validWebSearchTerms(value:unknown):value is string{
  return typeof value==="string"&&!!value.trim()&&[...value].length<=80&&value.trim().split(/\s+/u).length<=12
    &&!/[\u0000-\u001f\u007f]|https?:\/\/|\S+@\S+\.\S+/iu.test(value);
}
