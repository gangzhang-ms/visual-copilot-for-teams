import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {requireVisual} from "./visual-errors";
import type {LocalMessage} from "../shared/local-chat";
type DemoMessage=Pick<LocalMessage,"speaker"|"text"|"demoMedia">&{
  attachment?:{base64:string;mime:"image/png"|"image/gif";category:"image"|"gif"|"sticker"}
};
export async function localDemo(language:"en"|"zh-CN",scenario:"film"|"emoji"|"combined"="film"):Promise<DemoMessage[]>{
  const root=resolve("assets",scenario==="emoji"?"emoji-demo":"chat-demo");
  async function attachment(name:string,mime:"image/png"|"image/gif",manifestName="manifest.json"):Promise<NonNullable<DemoMessage["attachment"]>>{
    const manifest=JSON.parse(await readFile(resolve(root,manifestName),"utf8"));
    const bytes=await readFile(resolve(root,name)),entry=manifest.assets.find((a:{name:string})=>a.name===name);
    requireVisual(entry&&bytes.length<=1024*1024&&bytes.length===entry.bytes&&createHash("sha256").update(bytes).digest("hex")===entry.sha256,"unsupported-format");
    return {base64:bytes.toString("base64"),mime,category:scenario==="emoji"?"sticker":mime==="image/gif"?"gif":"image"};
  }
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  if(scenario==="combined"){
    const [film,emoji]=await Promise.all([localDemo(language,"film"),localDemo(language,"emoji")]);
    return [
      {...film[0],text:t("Proposal: one portal for deployments, alerts and billing.","提议：部署、告警、账单用一个门户。")},
      {...film[1],text:t("One portal to rule them all?","一个门户统领一切？")},
      {...film[2],text:t("Do we get time off if it fails?","挂了能放半天假吗？")},
      {...emoji[2],speaker:"Alex",text:t("Two deploy alerts came in. The portal can wait.","来了两条部署告警。门户以后再说。")},
      {...emoji[1],text:t("I'll help. Lunch can wait.","我来，午饭等等吧。")},
      {...emoji[3],text:t("I'm checking logs. 👩🏽‍💻","我在查日志。👩🏽‍💻")},
      {...emoji[5],speaker:"Alex",text:t("Both alerts are fixed. Handoff after lunch.","两条都已解决。午饭后交接。")},
      {...emoji[6],text:t("Thanks for the break. 🙏🙂","谢谢留出时间。🙏🙂")},
      {speaker:"Alex",text:t("Let's pilot dashboards; keep old links.","先试点仪表盘，旧链接保留。")}
    ];
  }
  if(scenario==="emoji")return [
    {speaker:"Alex",text:t("The alert is quiet now. Can we finish the handoff before lunch?","告警暂时安静了。午饭前能完成交接吗？")},
    {speaker:"Maya",text:t("I can take the next one.","下一个我来吧。"),attachment:await attachment("icon-01.png","image/png"),demoMedia:"custom-emoji" as const},
    {speaker:"Leo",text:t("Two more checks just came in.","又来了两项检查。"),attachment:await attachment("icon-02.png","image/png"),demoMedia:"custom-emoji" as const},
    {speaker:"Maya",text:t("I'm pairing with Leo on the last check. 👩🏽‍💻","最后一项我和 Leo 一起看。👩🏽‍💻")},
    {speaker:"Alex",text:t("The incident is closed. The handoff can wait until after lunch.","事件已关闭。交接可以等午饭后再做。")},
    {speaker:"Leo",text:t("All right.","好。"),attachment:await attachment("icon-03.png","image/png"),demoMedia:"custom-emoji" as const},
    {speaker:"Maya",text:t("Thanks for making room. 🙏🙂","谢谢留出时间。🙏🙂")}
  ];
  return [
    {speaker:"Alex",text:t("Proposal: one portal for deployments, alerts, and billing.","有个提议：部署、告警、账单，都放进同一个门户。")},
    {speaker:"Maya",text:t("Quite the little portal.","听起来挺省事。"),attachment:await attachment("film-reference.png","image/png","reference-manifest.json"),demoMedia:"user-reference" as const},
    {speaker:"Leo",text:t("So if it goes down, do we all get the afternoon off?","那它要是挂了，我们是不是都能放半天假？"),attachment:await attachment("owl-motion.gif","image/gif"),demoMedia:"local-motion" as const},
    {speaker:"Maya",text:t("I'll keep the old bookmarks. 🙂","旧书签我先留着。🙂")},
    {speaker:"Alex",text:t("Let's start with just the dashboards.","要不先只整合仪表盘吧。")}
  ];
}
