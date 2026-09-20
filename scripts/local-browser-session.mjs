export function ownedBrowserSession(page,origin){
  let csrf="",pending=Promise.resolve(),captureError;
  const capture=request=>{
    if(request.url()!==origin+"/local/session"||request.method()!=="POST")return;
    pending=pending.then(async()=>{
      const response=await request.response();
      if(!response||!response.ok())return;
      const value=await response.json();
      if(typeof value.csrf!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(value.csrf))throw new Error("Invalid synthetic session capability");
      csrf=value.csrf;
    }).catch(error=>{captureError=error;});
  };
  page.on("request",capture);
  return {
    async start(){
      const response=await page.request.get(origin+"/healthz");
      if(!response.ok()||(await response.json()).sessionClose!==true)throw new Error("This listener lacks authenticated session cleanup. Use an upgraded stopped build; do not run repeated checks against old live rooms.");
    },
    async close(){
      await pending;page.off("request",capture);
      if(captureError)throw captureError;
      if(!csrf)return {closed:false,notCreated:true};
      return page.evaluate(async({origin,csrf})=>{
        const headers={"Content-Type":"application/json","X-Local-CSRF":csrf};
        const before=await fetch(origin+"/local/state",{method:"POST",headers,body:"{}"});
        if(!before.ok)throw new Error("Cannot verify own synthetic room for cleanup");
        const state=await before.json();
        const response=await fetch(origin+"/local/session/close",{method:"POST",headers,body:"{}"});
        if(!response.ok||(await response.json()).closed!==true)throw new Error("Own synthetic room was not closed; cleanup did not allocate or evict another room");
        return {closed:true,generation:state.generation,interaction:state.interaction};
      },{origin,csrf});
    }
  };
}
