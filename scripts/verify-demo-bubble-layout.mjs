import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {chromium,expect} from "@playwright/test";
import {ownedBrowserSession} from "./local-browser-session.mjs";
const enlarge=process.argv[2]==="--enlarge",dir=resolve(".local","visual-context",enlarge?"emoji-enlarge-layout":"demo-polish-layout");
await mkdir(dir,{recursive:true});
const report={passed:false,providerActions:0,externalRequests:0,comparisons:[]};
const browser=await chromium.launch({channel:"msedge"});
try{
  for(const [label,port] of [["before",enlarge?4364:4362],["after",enlarge?4365:4364]]){
    const origin=`http://127.0.0.1:${port}`,context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();
    const owned=ownedBrowserSession(page,origin);await owned.start();
    const entry={label,origin,closed:false};
    try{
      await page.route("**/*",route=>{
        const url=new URL(route.request().url());
        if(["http:","https:"].includes(url.protocol)&&url.origin!==origin){report.externalRequests++;return route.abort();}
        if(/\/local\/(?:process|emoji\/suggest|catalog\/load|generation\/(?:process|batch\/(?:start|process|source\/retry)))$/.test(url.pathname)){
          report.providerActions++;return route.abort();
        }
        return route.continue();
      });
      await page.goto(origin+"/chat");await expect(page.getByLabel("Message",{exact:true})).toBeEnabled();
      const loaded=await page.evaluate(async()=>{
        const session=await(await fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
        const response=await fetch("/local/demo",{method:"POST",headers:{"Content-Type":"application/json","X-Local-CSRF":session.csrf},
          body:JSON.stringify({revision:session.revision,scenario:"emoji",language:"en"})});
        return {status:response.status,count:(await response.json()).messages.length};
      });
      expect(loaded).toEqual({status:200,count:7});
      await page.reload();await expect(page.getByTestId("chat-message")).toHaveCount(7);
      const row=page.getByTestId("chat-message").filter({hasText:"I can take the next one."});
      await row.scrollIntoViewIfNeeded();await row.hover();
      entry.layout=await row.evaluate(el=>{
        const size=selector=>{const rect=el.querySelector(selector).getBoundingClientRect();return {width:rect.width,height:rect.height};};
        return {bubble:size(".local-bubble"),artwork:size(".custom-emoji-artwork"),image:size(".custom-emoji-icon"),
          normalArtworkText:el.querySelector(".custom-emoji-artwork").innerText};
      });
      await row.screenshot({path:resolve(dir,`${label}-same-message.png`)});
      const trigger=row.getByRole("button",{name:"Enlarge custom emoji",exact:true});
      await trigger.focus();await page.keyboard.press("Enter");
      const dialog=page.getByRole("dialog",{name:"Custom emoji preview",exact:true});await expect(dialog).toBeVisible();
      entry.previewWidth=(await dialog.locator("img").boundingBox()).width;
      await dialog.getByRole("button",{name:"Close",exact:true}).click();await expect(trigger).toBeFocused();
      await trigger.click();await page.keyboard.press("Escape");await expect(trigger).toBeFocused();
      await row.getByRole("button",{name:"Message actions",exact:true}).click();
      await page.getByRole("menuitem",{name:"Media information",exact:true}).click();
      const information=page.getByRole("dialog",{name:"Media information",exact:true});await expect(information).toBeVisible();
      entry.mediaInformation=await information.innerText();await page.keyboard.press("Escape");
      if(label==="after"){
        expect(entry.layout.normalArtworkText).toBe(enlarge?"Enlarge":"");expect(entry.layout.artwork.height).toBeLessThanOrEqual(60);
        expect(entry.mediaInformation).toMatch(/original|locally authored/i);
      }
    }finally{
      report.comparisons.push(entry);await writeFile(resolve(dir,"report.json"),JSON.stringify(report,null,2));
      entry.cleanup=await owned.close();entry.closed=entry.cleanup.closed;await context.close();
    }
  }
  const [before,after]=report.comparisons;
  if(enlarge){
    expect(after.layout.bubble).toEqual(before.layout.bubble);
  }else{
    expect(after.layout.bubble.height).toBeLessThan(before.layout.bubble.height);
    expect(after.layout.bubble.width).toBeLessThan(before.layout.bubble.width);
  }
  expect(after.layout.image).toEqual({width:48,height:48});expect(after.previewWidth).toBe(256);
  expect(report.providerActions).toBe(0);expect(report.externalRequests).toBe(0);
  report.passed=true;
}finally{
  await browser.close();await writeFile(resolve(dir,"report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
