import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {CreativeConfirmation} from "./HumanConfirmation";
import {friendlyLocalError} from "./friendly-local-error";
import {emptySpeakerProfile} from "../shared/expression";
import type {LocalGenerationDraft} from "../shared/local-chat";
it.each(["en","zh-CN"] as const)("shows selected human choices without altering the draft in %s",language=>{
  const draft:LocalGenerationDraft={intent:"A user's meaningful (technical) wording stays.",creative:"An original owl",output:"gif",
    expression:{style:"deadpan-animal",intensity:"restrained",reference:"Quiet relief"},
    preferences:{source:"requester-reported",language,culture:"Fictional culture",tone:"Warm",familiarity:"",relationship:"Teammates",humor:"Gentle",avoid:"Mockery"},
    context:[{label:"A".repeat(43),text:"Reviewed context",included:true},{label:"B".repeat(43),text:"Excluded context",included:false}]};
  const before=structuredClone(draft),html=renderToStaticMarkup(<CreativeConfirmation draft={draft} speaker="Maya" profile={{...emptySpeakerProfile(),tone:"Sender tone"}} language={language}/>);
  for(const value of [draft.intent,draft.creative,"Quiet relief","Warm","Teammates","Mockery","Sender tone","Reviewed context","Maya"])
    expect(html).toContain(value.replaceAll("'","&#x27;"));
  for(const hidden of ["Excluded context","A".repeat(43),"B".repeat(43),"requester-reported","deadpan-animal","<pre"])
    expect(html).not.toContain(hidden);
  expect(html).toContain(language==="en"?"Deadpan cute animal":"淡定小动物");
  expect(draft).toEqual(before);
});
it.each(["en","zh-CN"] as const)("maps failure/status categories without echoing technical payloads in %s",language=>{
  for(const code of ["model-request-envelope-exceeded","model-output-invalid-json","generation-credential-unavailable","generation-rate-limited","generation-animation-failed-image-retained","PRIVATE_ENDPOINT_TOKEN"]){
    const result=friendlyLocalError(code,language);
    expect(result.length).toBeGreaterThan(10);expect(result).not.toContain(code);
    expect(result).not.toMatch(/JSON|API|bytes|endpoint|profile|PRIVATE/);
  }
  expect(friendlyLocalError("model-provider-unavailable",language)).not.toBe(friendlyLocalError("model-network-error",language));
});
