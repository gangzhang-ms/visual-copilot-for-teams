import {expect,it} from "vitest";
import {validDemoChatId,demoRoomUrl,scopedDemoMedia,demoRoomLifetimeMs} from "./demo-room";
it.each(["demo123","A-b_C","0","x".repeat(64)])("accepts a bounded user-chosen Chat ID: %s",id=>{
  expect(validDemoChatId(id)).toBe(true);expect(demoRoomUrl(id)).toBe(`/chat?chatId=${id}`);
});
it.each(["","x".repeat(65),"demo\n"," space","room/a","..","中文","a?b","a&b","a%20b",null,123])("rejects invalid ID %s",id=>{
  expect(validDemoChatId(id)).toBe(false);
});
it("scopes every local media URL field without rewriting content or external links",()=>{
  for(const key of ["imageUrl","animationUrl","posterUrl","mediaUrl"]){
    for(const path of ["/local/assets/a/still","/local/generated/id/image","/local/memes/version/item.png"])
      expect(scopedDemoMedia(key,path,"demo123")).toBe(`${path}?chatId=demo123`);
    expect(scopedDemoMedia(key,"https://example.invalid/image.png","demo123")).toBe("https://example.invalid/image.png");
  }
  expect(scopedDemoMedia("caption","/local/generated/id/image","demo123")).toBe("/local/generated/id/image");
  expect(demoRoomLifetimeMs).toBe(1_800_000);
});
