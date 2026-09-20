export const LOCAL_CONTEXT_LIMIT = 10;
// Excluded editable rows remain bounded separately from transmitted messages.
export const LOCAL_CONTEXT_REVIEW_LIMIT = 12;

export function localContextWithinLimit(context:readonly {included:boolean}[]){
  return context.filter(row=>row.included).length<=LOCAL_CONTEXT_LIMIT;
}

export function selectLocalContextMessages<T extends {id:string}>(messages:readonly T[],selectedId?:string):T[]{
  const recent=messages.slice(-LOCAL_CONTEXT_LIMIT);
  const selected=selectedId?messages.find(message=>message.id===selectedId):undefined;
  return selected&&!recent.some(message=>message.id===selected.id)
    ?[selected,...recent.slice(-(LOCAL_CONTEXT_LIMIT-1))]:recent;
}
