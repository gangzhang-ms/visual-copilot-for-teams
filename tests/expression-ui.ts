import {expect,type Page,type Route} from "@playwright/test";
import type {LocalGenerationReview} from "../src/shared/local-chat";
export async function holdCreationReview(page:Page){
  let deliver!:(review:LocalGenerationReview)=>void,unblock!:()=>void,finished!:()=>void;
  const review=new Promise<LocalGenerationReview>(resolve=>{deliver=resolve;}),gate=new Promise<void>(resolve=>{unblock=resolve;});
  const done=new Promise<void>(resolve=>{finished=resolve;});
  page.once("close",unblock);
  const handler=async(route:Route)=>{
    try{
      const response=await route.fetch();expect(response.status()).toBe(200);deliver(await response.json());
      await gate;if(!page.isClosed())await route.fulfill({response});
    }finally{finished();}
  };
  await page.route("**/local/generation/review",handler);
  return {review,release:async()=>{unblock();await done;page.off("close",unblock);if(!page.isClosed())await page.unroute("**/local/generation/review",handler);}};
}
export async function openCreationOptions(page:Page){
  const options=page.locator(".creation-advanced");
  if(await options.count()&&await options.getAttribute("open")===null)await options.locator(":scope > summary").click();
}
export async function openCreate(page:Page,language="en",advanced=true){
  await expect(page.locator("main.local-layout")).not.toHaveAttribute("inert","");
  const tabs=page.locator(".local-tabs"),legacy=tabs.getByRole("button",{name:language==="en"?"Create":"创作",exact:true});
  if(!await tabs.isVisible())await page.locator(".local-composer").getByRole("button",{name:language==="en"?"Help me express":"帮我表达",exact:true}).click();
  if(await legacy.count())await legacy.click();
  else{
    await tabs.getByRole("button",{name:language==="en"?"Express":"帮我表达",exact:true}).click();
    await page.getByRole("radio",{name:language==="en"?"Create a new image":"生成新图",exact:true}).check();
  }
  if(advanced)await openCreationOptions(page);
}
