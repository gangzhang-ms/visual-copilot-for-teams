import { expect,test,type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import type { createLocalChatServer as Factory } from "../../src/server/local-chat-server";
import {openCreate} from "../expression-ui";

let app:Awaited<ReturnType<typeof Factory>>,origin:string,expectedCalls=0;
test.beforeEach(async()=>{
  expectedCalls=0;
  const root=process.env.VISUAL_BUILD_ROOT??"dist";
  const {createLocalChatServer}:{createLocalChatServer:typeof Factory}=await import(pathToFileURL(resolve(root,"server","local-chat-server.js")).href);
  const {localPaidLease}=await import(pathToFileURL(resolve(root,"server","local-generation-config.js")).href);
  expect(localPaidLease.busy).toBe(false);localPaidLease.nextAt=0;localPaidLease.providerNextAt=0;
  app=await createLocalChatServer("OFFLINE-STUDIO-TEST",{
    clientRoot:resolve(root,"client"),interaction:"direct-personal",catalogSource:"original-demo",cooldownMs:0,
    transport:async(_url,init)=>{
      if(!expectedCalls)throw new Error("Studio navigation must not dispatch AI");
      const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content[0].text);
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        background:{source:null,context:null,frames:[]},observations:[{text:"Synthetic studio explanation",frames:input.frames.map((f:{id:string})=>f.id)}],commonUsage:["Context dependent"],
        contextualInterpretations:[{text:"Fictional only",context:input.context.map((c:{label:string})=>c.label)}],
        uncertainties:["Unknown intent"],safeResponseGuidance:["Ask kindly"]
      })}}]});
    }
  });
  origin=await app.start(0);
});
test.afterEach(async()=>{expect(app.counters.providerRequests).toBe(expectedCalls);expect(app.generationCounters.providerRequests).toBe(0);await app.close();});
async function open(page:Page){
  await page.setViewportSize({width:1440,height:900});await page.goto(origin+"/chat");
  await expect(page.getByLabel("Language / 语言")).toBeEnabled();
  await page.getByLabel("Language / 语言").selectOption("en");
  await expect(page.getByRole("button",{name:"Start a demo conversation",exact:true})).toBeEnabled();
}
test("studio demo, Enter/Shift+Enter/IME, emoji, attachments and local search never call AI",async({page})=>{
  await open(page);await page.getByRole("button",{name:"Start a demo conversation",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(5);
  await expect(page.getByRole("button",{name:"Load demo conversation",exact:true})).toBeDisabled();
  await expect(page.getByText("Authored demo · loading makes no AI call", {exact:true})).toBeVisible();
  await expect(page.getByTestId("chat-message").locator('img[src^="data:image/png"]')).toHaveCount(1);
  await expect(page.getByTestId("chat-message").locator('img[src^="data:image/gif"]')).toHaveCount(1);
  const draft=page.getByLabel("Message",{exact:true});
  await draft.fill("My original first line");await draft.press("Shift+Enter");await draft.press("a");
  await expect(draft).toHaveValue("My original first line\na");
  await draft.dispatchEvent("keydown",{key:"Enter",code:"Enter",isComposing:true});
  await expect(page.getByTestId("chat-message")).toHaveCount(5);
  await draft.press("Enter");await expect(page.getByTestId("chat-message")).toHaveCount(6);
  await expect(page.getByTestId("chat-message").last()).toContainText("My original first line\na");
  await page.getByLabel("Emoji picker",{exact:true}).click();await page.getByRole("button",{name:"💜",exact:true}).click();
  await expect(draft).toBeFocused();await expect(draft).toHaveValue("💜");
  const bytes=await sharp({create:{width:32,height:32,channels:3,background:"#7366bf"}}).png().toBuffer();
  await page.getByLabel("Attach visual",{exact:true}).setInputFiles({name:"owned-square.png",mimeType:"image/png",buffer:bytes});
  await expect(page.getByAltText("Attachment preview")).toBeVisible();await draft.press("Enter");
  await expect(page.getByTestId("chat-message")).toHaveCount(7);await expect(page.getByTestId("chat-message").last().getByAltText("Owned test visual")).toBeVisible();
  await page.getByLabel("Search this conversation",{exact:true}).fill("original first");
  await expect(page.getByTestId("chat-message")).toHaveCount(1);await page.getByRole("button",{name:"Clear search",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(7);
});
test("message keyboard menu restores focus and reviews the actual selected message beyond recent ten",async({page})=>{
  await open(page);
  const bytes=await sharp({create:{width:32,height:32,channels:3,background:"#7366bf"}}).png().toBuffer();
  await page.getByLabel("Attach visual",{exact:true}).setInputFiles({name:"owned-square.png",mimeType:"image/png",buffer:bytes});
  await expect(page.getByAltText("Attachment preview")).toBeVisible();
  for(let i=0;i<13;i++){
    await page.getByLabel("Message",{exact:true}).fill(`Authored message ${i}`);await page.getByLabel("Message",{exact:true}).press("Enter");
    await expect(page.getByTestId("chat-message")).toHaveCount(i+1);
  }
  const first=page.getByTestId("chat-message").first(),trigger=first.getByRole("button",{name:"Message actions",exact:true});
  await trigger.focus();await trigger.press("ArrowDown");
  await expect(page.getByRole("menuitem",{name:"Explain this message",exact:true})).toBeFocused();
  await page.keyboard.press("End");await expect(page.getByRole("menuitem",{name:"Remove message",exact:true})).toBeFocused();
  await page.keyboard.press("Escape");await expect(trigger).toBeFocused();await expect(page.getByRole("menu")).toHaveCount(0);
  expectedCalls=1;await trigger.press("ArrowDown");await page.keyboard.press("Enter");
  await expect(page.getByRole("heading",{name:"Possible meaning",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Edit context / reanalyze",exact:true}).click();
  await expect(first).toHaveClass(/selected/);await expect(page.getByLabel("Context 1",{exact:true})).toHaveValue("Alex: Authored message 0");
  await expect(page.getByRole("checkbox",{name:/Include context/})).toHaveCount(10);
  await page.getByLabel("Context 1",{exact:true}).fill("Edited owned context");
  await page.getByRole("button",{name:"Review selected content",exact:true}).click();
  await expect(page.getByRole("region",{name:"Content confirmation"})).toContainText("Edited owned context");
  await expect(page.getByRole("button",{name:"Explain with AI",exact:true})).toBeEnabled();
  await expect(page.getByRole("region",{name:"Content confirmation"}).getByRole("checkbox")).toHaveCount(0);
});
test("compact drawers, bilingual framing and real previews retain state without overflow",async({page})=>{
  await open(page);await page.getByRole("button",{name:"Start a demo conversation",exact:true}).click();
  await expect(page.getByTestId("chat-message")).toHaveCount(5);
  await mkdir(resolve(".local","visual-context","studio-screenshots"),{recursive:true});
  for(const width of [1920,1440,1120,768,320]){
    await page.setViewportSize({width,height:width===1920?1080:900});
    if(width<1100&&await page.getByRole("button",{name:"Hide AI panel",exact:true}).isVisible())await page.getByRole("button",{name:"Hide AI panel",exact:true}).click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
    await page.screenshot({path:resolve(".local","visual-context","studio-screenshots",`offline-${width}.png`)});
  }
  const express=page.getByRole("button",{name:"Help me express",exact:true});
  await express.click();await expect(page.getByRole("dialog",{name:"AI workspace"})).toBeVisible();
  await page.getByLabel("What would you like to express?",{exact:true}).fill("Offer original encouragement");
  await page.getByRole("button",{name:"Review selected content",exact:true}).click();
  await expect(page.getByRole("button",{name:"Recommend expressions",exact:true})).toBeEnabled();
  await page.keyboard.press("Escape");await expect(express).toBeFocused();
  await page.getByRole("button",{name:"Open AI panel",exact:true}).click();
  await expect(page.getByRole("region",{name:"Content confirmation"})).toContainText("Offer original encouragement");
  await page.keyboard.press("Escape");
  const chat=page.getByRole("navigation",{name:"App navigation"}).getByRole("button",{name:"Chat",exact:true});
  await chat.click();await expect(page.getByRole("button",{name:"Close chats",exact:true})).toBeFocused();
  await page.keyboard.press("Escape");await expect(chat).toBeFocused();
  await page.getByLabel("Language / 语言").selectOption("zh-CN");
  await openCreate(page,"zh-CN");
  await expect(page.getByLabel("你想表达什么？",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:resolve(".local","visual-context","studio-screenshots","offline-320-drawer-zh.png")});
});
