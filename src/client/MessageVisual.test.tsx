import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {MessageVisual} from "./MessageVisual";
import type {LocalMessage} from "../shared/local-chat";
const message:LocalMessage={id:"owned",speaker:"Maya",text:"Owned visual",visual:{
  id:"source",version:"1",category:"image",alt:"Owned search fixture",imageUrl:"data:image/png;base64,fixture",
  webSource:{kind:"web-image-preview",provider:"Google Images via SerpApi",query:"fabricated",title:"Fixture",pageUrl:"https://example.org",fetchedAt:1,
    preview:{width:80,height:40,downloadWidth:80,downloadHeight:40}},
  notices:{version:"1",source:"Fixture",creator:"Unknown",license:"Unverified",text:[],links:[]}
}};
it("source-result chat visuals retain the clarity warning without an arbitrary original URL or nested action",()=>{
  const html=renderToStaticMarkup(<MessageVisual message={message} language="en"/>);
  expect(html).toContain("Enlarge image");expect(html).toContain("Small thumbnail");
  expect(html).toContain("Enlarging cannot restore them");expect(html).not.toContain("<dialog");
  expect(html.match(/<button\b/g)).toHaveLength(1);expect(html).not.toContain('src="https:');
});
it("generated animation keeps an explicit playback control and GIF enlargement",()=>{
  const html=renderToStaticMarkup(<MessageVisual language="en" message={{id:"owned",speaker:"Maya",text:"",generated:{
    assetId:"owned",version:1,variant:"animation",category:"gif",posterUrl:"/local/poster",mediaUrl:"/local/motion",digest:"owned",
    width:512,height:512,alt:"Owned animation",method:"generated-image-local-animation",model:"fixture",modelVersion:"1",recipe:"pan-zoom-v1",pendingReview:true
  }}}/>);
  expect(html).toContain("Enlarge GIF");expect(html).toContain("Play animation");expect(html).toContain('src="/local/poster"');
});
