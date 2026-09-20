import {describe,it,expect} from "vitest";
import {buildCreativeBrief} from "./local-generation";
import {offlineDraft} from "./generation.test.support";
import {emptySpeakerProfile,validSpeakerProfile,validSpeakerContext,expressionStyles,type SpeakerContext} from "../shared/expression";
describe("chat-native expression brief",()=>{
  it("uses semantic chat direction, not arbitrary geometry, with unchanged bounded provider options",()=>{
    const built=buildCreativeBrief(offlineDraft(),[]);
    expect(built.prompt).toContain("readable as a small 128px chat thumbnail");
    expect(built.prompt).toContain("Avoid arbitrary geometry");
    expect(JSON.parse(built.body)).toMatchObject({n:1,size:"1024x1024",quality:"low",output_format:"png"});
  });
  it("makes auto plus all six explicit presets and intensity/reference part of the actual exact request",()=>{
    const bodies=expressionStyles.map(style=>{
      const result=buildCreativeBrief({...offlineDraft(),expression:{style:style.id,intensity:"restrained",reference:"a quietly relieved original character"}},[]);
      expect(result.prompt).toContain(style.direction);expect(result.prompt).toContain('"intensity":"restrained"');
      return result.body;
    });
    expect(new Set(bodies).size).toBe(7);
    expect(expressionStyles.map(style=>style.id)).toEqual(expect.arrayContaining(["natural-photo","cinematic-photo"]));
    expect(()=>buildCreativeBrief({...offlineDraft(),expression:{style:"latest-trend",intensity:"restrained",reference:""}},[])).toThrow();
  });
  it("separates voluntary speaker report and audience, differentiates profiles without inferring identity",()=>{
    const context:SpeakerContext={role:"outgoing-speaker",source:"voluntary-local-report",profile:null};
    const unknown=buildCreativeBrief(offlineDraft(),[],context);
    expect(unknown.prompt).toContain('"profile":null');
    const one=buildCreativeBrief(offlineDraft(),[],{...context,profile:{...emptySpeakerProfile(),language:"zh-CN",tone:"restrained thanks"}});
    const two=buildCreativeBrief(offlineDraft(),[],{...context,profile:{...emptySpeakerProfile(),language:"en",humor:"playful deadpan"}});
    expect(one.body).not.toBe(two.body);
    expect(one.prompt).toContain("requesterOrAudiencePreferences");
    expect(one.prompt).toContain("Language is not ethnicity");
  });
  it("bounds profiles, rejects inferred metadata, and never accepts a browser profile in generation draft",()=>{
    expect(validSpeakerProfile(emptySpeakerProfile())).toBe(true);
    expect(validSpeakerProfile({...emptySpeakerProfile(),culture:"a".repeat(201)})).toBe(false);
    expect(validSpeakerProfile({...emptySpeakerProfile(),nationality:"inferred"})).toBe(false);
    expect(validSpeakerContext({role:"requester",source:"voluntary-local-report",profile:null})).toBe(false);
    expect(()=>buildCreativeBrief({...offlineDraft(),speakerContext:{profile:"forged"}},[])).toThrow();
  });
  it.each(["结合电影角色","福尔摩斯发现问题后的得意表情，用来庆祝排查成功","Sherlock Holmes and Watson celebrating a solved problem"])("preserves the exact primary character request with neutral direction: %s",intent=>{
    const result=buildCreativeBrief({...offlineDraft(),intent,creative:"",expression:{style:"auto",intensity:"auto",reference:""}},[]);
    const provider=JSON.parse(result.body),quoted=JSON.parse(provider.prompt.split("\n").at(-1));
    expect(quoted).toMatchObject({intent,creative:"",expression:{style:"auto",intensity:"auto",reference:""}});
    expect(quoted.styleDirection).toBe(expressionStyles[0].direction);
    expect(result.prompt).toContain("Preserve multiple characters when requested");
    expect(result.prompt).toContain("generic cinematic archetype");
    expect(result.prompt).toContain("Do not reproduce movie frames, posters, logos");
    expect(result.prompt).not.toContain("Do not copy recognizable copyrighted characters");
    expect(result.prompt).not.toContain("Use one dominant original character");
    expect(provider).toMatchObject({n:1,size:"1024x1024",quality:"low",output_format:"png"});
  });
  it("retains explicit advanced presets and details but makes the primary description's precedence explicit",()=>{
    const result=buildCreativeBrief({...offlineDraft(),intent:"Two human literary detectives, in watercolor",creative:"A separate optional detail",
      expression:{style:"deadpan-animal",intensity:"exaggerated",reference:"An original cinematic scene"}},[]);
    expect(result.prompt).toContain("style, intensity, context and preferences are secondary when they conflict");
    expect(result.prompt).toContain("Two human literary detectives, in watercolor");
    expect(result.prompt).toContain("A separate optional detail");
    expect(result.prompt).toContain('"style":"deadpan-animal"');
  });
});
