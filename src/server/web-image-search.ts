import type {ImageAttribution} from "../shared/types";
export interface WebImageSearchQuery {terms:string}
export interface WebImageSearchItem {
  id:string;title:string;imageUrl:string;thumbnailUrl?:string;sourcePageUrl:string;
  attribution?:ImageAttribution;
}
export interface WebImageSearchProvider {
  readonly id:string;
  readonly configured:boolean;
  search(query:Readonly<WebImageSearchQuery>,signal:AbortSignal):Promise<readonly WebImageSearchItem[]>;
}
export type WebImageSearchResult=
  | {status:"metadata";provider:string;items:readonly WebImageSearchItem[]}
  | {status:"unavailable";code:"web-image-search-not-configured"}
  | {status:"empty";provider:string};

export class WebImageSearchError extends Error {
  constructor(readonly code:"web-image-search-invalid-query"|"web-image-search-query-planning"|"web-image-search-cancelled"|"web-image-search-invalid-response"|"web-image-search-unavailable"|"web-image-search-auth"|"web-image-search-rate-limited"|"web-image-search-unsafe-result"|"web-image-search-credential-unavailable"){super(code);}
}
export function validateWebImageSearchQuery(value:unknown):Readonly<WebImageSearchQuery>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new WebImageSearchError("web-image-search-invalid-query");
  const query=value as Record<string,unknown>;
  if(Object.keys(query).join(",")!=="terms"||typeof query.terms!=="string"||!query.terms.trim()
    ||[...query.terms].length>180||/[\u0000-\u001f\u007f]/u.test(query.terms))throw new WebImageSearchError("web-image-search-invalid-query");
  return Object.freeze({terms:query.terms});
}

// Metadata is not an owned/insertable image. Downloading it requires a separately
// validated allowlisted image fetch and the existing bounded native decoder.
export async function searchWebImages(provider:WebImageSearchProvider|undefined,query:unknown,signal:AbortSignal):Promise<WebImageSearchResult>{
  if(signal.aborted)throw new WebImageSearchError("web-image-search-cancelled");
  if(!provider?.configured)return {status:"unavailable",code:"web-image-search-not-configured"};
  const reviewed=validateWebImageSearchQuery(query);
  const items=await provider.search(reviewed,signal);
  if(signal.aborted)throw new WebImageSearchError("web-image-search-cancelled");
  return items.length?{status:"metadata",provider:provider.id,items}:{status:"empty",provider:provider.id};
}
