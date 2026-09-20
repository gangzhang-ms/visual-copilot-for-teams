import {chromium,expect} from "@playwright/test";
import {mkdir,open,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {buildRoot,builtUrl} from "./build-root.mjs";
import {ownedBrowserSession} from "./local-browser-session.mjs";

// Fixed original demo only; never accepts a room, upload, profile or free-text argument.
export async function diagnoseExplain(key){
  delete process.env.MODEL_API_KEY;
  if(buildRoot.toLowerCase()!==resolve("dist-chat-natural-demo").toLowerCase())throw new Error("diagnostic-root-mismatch");
  const directory=resolve(".local","visual-context","explain-fix-validation");
  await mkdir(directory,{recursive:true});
  const report={phase:"baseline",providerRequests:0,dispatches:[],ownRoomClosed:false};
  const known=["observations","commonUsage","contextualInterpretations","uncertainties","safeResponseGuidance"];
  const textShape=value=>({type:typeof value,length:typeof value==="string"?value.length:0,
    blank:typeof value==="string"&&!value.trim(),controls:typeof value==="string"&&/[<>\u0000-\u001f]/u.test(value)});
  let capture=Promise.resolve();
  const {createLocalChatServer}=await import(builtUrl("local-chat-server.js"));
  const chat=await createLocalChatServer(key,{interaction:"direct-personal",clientRoot:resolve(buildRoot,"client"),
    transport:async(url,init)=>{
      const body=JSON.parse(init.body),payload=JSON.parse(body.messages[1].content[0].text);
      if(report.providerRequests||payload.task!=="explain"||payload.frames.length!==2||payload.context.length!==5
        ||!payload.context.every(c=>["Alex: 登录修好了，再试试？","Maya: 这次可以了！陪我查了这么久，谢啦。","Leo: 我这边也好了，终于能下班了。","Maya: 今晚别再改了😂","Alex: 同意，明天再说。"].includes(c.text)))
        throw new Error("diagnostic-input-rejected");
      const marker=await open(resolve(directory,"baseline-attempt.json"),"wx");
      await marker.writeFile(JSON.stringify({startedAt:new Date().toISOString(),maximumCalls:1}));await marker.close();
      report.providerRequests++;
      const started=performance.now(),response=await fetch(url,init);
      const dispatch={httpStatus:response.status,elapsedMs:0,apiVersion:new URL(url).searchParams.get("api-version"),
        requestBytes:Buffer.byteLength(init.body),images:payload.frames.length,contexts:payload.context.length,
        outputReserve:body.max_tokens??body.max_completion_tokens,responseFormat:body.response_format.type};
      report.dispatches.push(dispatch);
      capture=(async()=>{
        const reader=response.clone().body.getReader(),chunks=[];let size=0;
        try{
          for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>64000){await reader.cancel();dispatch.envelope="oversize";return;}chunks.push(value);}
          const envelope=JSON.parse(Buffer.concat(chunks).toString("utf8")),choice=envelope.choices?.[0];
          dispatch.finishReason=["stop","length","content_filter","tool_calls"].includes(choice?.finish_reason)?choice.finish_reason:"other";
          dispatch.refusal=!!choice?.message?.refusal;
          dispatch.toolCalls={present:Object.hasOwn(choice?.message??{},"tool_calls"),array:Array.isArray(choice?.message?.tool_calls),
            count:Array.isArray(choice?.message?.tool_calls)?choice.message.tool_calls.length:0};
          const output=JSON.parse(choice?.message?.content??"null");
          dispatch.fields=known.filter(k=>Object.hasOwn(output??{},k));
          dispatch.unknownFieldCount=Object.keys(output??{}).filter(k=>!known.includes(k)).length;
          dispatch.shape={};
          for(const field of known){
            const value=output?.[field];
            dispatch.shape[field]={array:Array.isArray(value),count:Array.isArray(value)?value.length:0};
            if(Array.isArray(value))dispatch.shape[field].items=value.slice(0,9).map(item=>{
              if(!["observations","contextualInterpretations"].includes(field))return textShape(item);
              const refs=field==="observations"?"frames":"context",allowed=field==="observations"?payload.frames.map(f=>f.id):payload.context.map(c=>c.label);
              return {text:textShape(item?.text),expectedFields:item!==null&&typeof item==="object"&&Object.keys(item).sort().join(",")===[refs,"text"].sort().join(","),
                refsArray:Array.isArray(item?.[refs]),referenceCount:Array.isArray(item?.[refs])?item[refs].length:0,
                unknownReferences:Array.isArray(item?.[refs])?item[refs].filter(id=>!allowed.includes(id)).length:0};
            });
          }
        }catch{dispatch.envelope="invalid-json-or-shape";}
        finally{dispatch.elapsedMs=Math.round(performance.now()-started);reader.releaseLock();}
      })();
      return response;
    }});
  const origin=await chat.start(0),browser=await chromium.launch({executablePath:resolve(process.env.SystemRoot,"..","Program Files (x86)","Microsoft","Edge","Application","msedge.exe")}),context=await browser.newContext(),page=await context.newPage(),owned=ownedBrowserSession(page,origin);
  try{
    await owned.start();await page.goto(origin+"/chat");
    await expect(page.getByLabel("消息内容",{exact:true})).toBeEnabled();
    await page.getByRole("button",{name:"从演示对话开始",exact:true}).click();
    await expect(page.getByTestId("chat-message")).toHaveCount(5);
    const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==="/local/process",{timeout:60000});
    await page.getByTestId("chat-message").nth(2).getByRole("button",{name:"解释一下",exact:true}).click();
    const response=await responsePromise,value=await response.json();await capture;
    report.appHttpStatus=response.status();report.appCode=value.code??value.result?.status??"unknown";
    report.resultKind=value.result?.kind;
  }finally{
    try{report.ownRoomClosed=(await owned.close()).closed;}finally{await context.close();await browser.close();await chat.close();await capture;
      report.recordedAt=new Date().toISOString();await writeFile(resolve(directory,"baseline-report.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));}
  }
}
