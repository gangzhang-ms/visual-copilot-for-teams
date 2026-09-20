import {describe,it,expect} from "vitest";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import sharp from "sharp";
import {localDemo} from "./local-demo";
import {LOCAL_CONTEXT_LIMIT} from "../shared/local-context";

describe("contextual local demo",()=>{
  for(const language of ["en","zh-CN"] as const)it(`${language} combines the same owned media into one coherent nine-message thread`,async()=>{
    const combined=await localDemo(language,"combined"),film=await localDemo(language,"film"),emoji=await localDemo(language,"emoji");
    expect(combined).toHaveLength(9);expect(combined.length).toBeLessThanOrEqual(LOCAL_CONTEXT_LIMIT);
    expect(combined[0].text).toContain(language==="en"?"portal":"门户");
    expect(combined[1]).toMatchObject({attachment:film[1].attachment,demoMedia:"user-reference"});
    expect(combined[2]).toMatchObject({attachment:film[2].attachment,demoMedia:"local-motion"});
    expect(combined[3]).toMatchObject({attachment:emoji[2].attachment,demoMedia:"custom-emoji"});
    expect(combined[4]).toMatchObject({attachment:emoji[1].attachment,demoMedia:"custom-emoji"});
    expect(combined[6]).toMatchObject({speaker:"Alex",attachment:emoji[5].attachment,demoMedia:"custom-emoji"});
    expect(combined[1].text).toContain(language==="en"?"rule them all":"统领一切");
    expect(combined[2].text).toContain(language==="en"?"if it fails":"挂了");
    expect(combined[3].text).toContain(language==="en"?"deploy alerts came in":"部署告警");
    expect(combined[3].text).toContain(language==="en"?"portal can wait":"门户以后再说");
    expect(combined[4].text).toContain(language==="en"?"Lunch can wait":"午饭等等");
    expect(combined[6].text).toContain(language==="en"?"Both alerts are fixed":"两条都已解决");
    expect(combined[8].text).toContain(language==="en"?"pilot dashboards":"试点仪表盘");
    expect(combined[8].text).toContain(language==="en"?"keep old links":"旧链接保留");
    expect(combined.filter(m=>m.attachment)).toHaveLength(5);
    expect(combined.filter(m=>m.demoMedia==="custom-emoji")).toHaveLength(3);
    expect(combined[5].text).toContain(language==="en"?"checking logs. 👩🏽‍💻":"查日志。👩🏽‍💻");expect(combined[7].text).toContain("🙏🙂");
    expect(JSON.stringify(combined.map(({attachment,...message})=>message))).not.toMatch(/Gandalf|One Ring|Lord of the Rings|strained|brain|sarcasm/i);
  });
  for(const language of ["en","zh-CN"] as const)it(`${language} keeps the original custom-image scenario separate from the film demo`,async()=>{
    const messages=await localDemo(language,"emoji"),icons=messages.filter(m=>m.demoMedia==="custom-emoji");
    expect(messages).toHaveLength(7);expect(messages.length).toBeLessThanOrEqual(LOCAL_CONTEXT_LIMIT);expect(icons).toHaveLength(3);
    expect(messages[3].text).toContain("👩🏽‍💻");expect(messages[6].text).toContain("🙏🙂");
    expect(messages[0].text).toContain(language==="en"?"handoff":"交接");
    expect(JSON.stringify(messages.map(({attachment,...message})=>message))).not.toMatch(/portal|Gandalf|strained|brain|exhaust|polite.smile|勉强|大脑|疲惫/iu);
    const manifest=JSON.parse(await readFile(resolve("assets","emoji-demo","manifest.json"),"utf8"));
    expect(manifest.origin).toContain("no external assets or AI generation");
    for(const [index,icon] of icons.entries()){
      expect(icon.attachment?.category).toBe("sticker");expect(icon.attachment?.mime).toBe("image/png");
      const bytes=Buffer.from(icon.attachment!.base64,"base64"),entry=manifest.assets[index],metadata=await sharp(bytes).metadata();
      expect(entry).toMatchObject({name:`icon-0${index+1}.png`,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),width:384,height:384});
      expect(metadata).toMatchObject({format:"png",width:384,height:384});
      expect(bytes.length).toBeLessThan(1024*1024);expect(metadata.exif).toBeUndefined();
    }
  });
  for(const language of ["en","zh-CN"] as const)it(`${language} preserves the synthetic publication fixture without a canned interpretation`,async()=>{
    const messages=await localDemo(language);
    expect(messages).toHaveLength(5);expect(messages.length).toBeLessThanOrEqual(LOCAL_CONTEXT_LIMIT);
    expect(messages.map(m=>m.speaker)).toEqual(["Alex","Maya","Leo","Maya","Alex"]);
    const t=(en:string,zh:string)=>language==="en"?en:zh;
    expect(messages[0].text).toContain(t("one portal","同一个门户"));
    for(const tool of language==="en"?["deployments","alerts","billing"]:["部署","告警","账单"])
      expect(messages[0].text).toContain(tool);
    expect(messages[2].text).toContain(t("if it goes down","它要是挂了"));
    expect(messages[3].text).toContain(t("old bookmarks","旧书签"));
    expect(messages[4].text).toContain(t("just the dashboards","只整合仪表盘"));
    expect(messages[1].demoMedia).toBe("user-reference");
    expect(messages[2].attachment?.mime).toBe("image/gif");
    expect(messages[3].text).toContain("🙂");
    expect(JSON.stringify(messages.map(({attachment,...message})=>message))).not.toMatch(/Gandalf|Lord of the Rings|One Ring|sarcasm|centraliz|甘道夫|魔戒|讽刺/iu);
    const bytes=Buffer.from(messages[1].attachment!.base64,"base64");
    const manifest=JSON.parse(await readFile(resolve("assets","chat-demo","reference-manifest.json"),"utf8"));
    expect(manifest.origin).toBe("Synthetic geometric publication fixture; not a film frame or source-recognition acceptance");
    expect(manifest.assets[0]).toMatchObject({bytes:bytes.length,width:380,height:301,frames:1,
      sha256:"9803faaf8f85f7c8ace9213c92f98b287f81bf432217a678b38efd51ec91d20d",
      sourceSha256:"4d1ef6b17eafc1d8148dda5ad1590db40fa7f57cb049f8d2ec626fae4eb2e6a2"});
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.assets[0].sha256);
    expect(bytes.length).toBeLessThanOrEqual(1024*1024);
    expect(await sharp(bytes).metadata()).toMatchObject({format:"png",width:380,height:301});
  });
});
