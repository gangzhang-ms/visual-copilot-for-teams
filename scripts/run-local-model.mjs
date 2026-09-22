import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildRoot, builtUrl } from "./build-root.mjs";
const { loadDevelopmentModelConfig, developmentSettings } = await import(builtUrl("development-model.js"));
const { visualReadiness } = await import(builtUrl("visual-config.js"));
const { runDevelopmentSynthetic } = await import(builtUrl("development-synthetic.js"));

const mode = process.argv[2];
try {
  if (process.argv.length !== 3 || !["readiness", "synthetic", "start", "chat","imageinit","imagestatus","imagecanary","imagechat","localopen","explainprobe"].includes(mode)) throw new Error("invalid-local-mode");
  const config = mode==="localopen"||mode==="explainprobe"?{modelKey:process.env.MODEL_API_KEY}:loadDevelopmentModelConfig(process.env.MODEL_API_KEY);
  if(mode==="explainprobe"){
    const {diagnoseExplain}=await import("./diagnose-explain.mjs");await diagnoseExplain(config.modelKey);
  }else if(mode==="localopen"){
    if(!config.modelKey?.trim())throw new Error("generation-credential-unavailable");
    const {createLocalChatServer}=await import(builtUrl("local-chat-server.js"));
    const {ongoingPersonalGenerationOptions}=await import(builtUrl("personal-image.js"));
    const port=Number(process.env.LOCAL_CHAT_PORT??4320);
    const commonsCreation=["dist-chat-commons-create","dist-chat-commons-fix"].some(name=>buildRoot===resolve(import.meta.dirname,"..",name));
    const serpCreation=["dist-chat-shared-demo","dist-chat-live-sync","dist-chat-film-context","dist-chat-style-continuity","dist-chat-compact-explain","dist-chat-visual-inline","dist-chat-emoji-consistent","dist-chat-emoji-inline","dist-chat-emoji-disclosure","dist-chat-emoji-enlarge","dist-chat-demo-polish-fixed","dist-chat-demo-polish","dist-chat-combined-demo","dist-chat-google-create","dist-chat-google-thumbnails",    "dist-chat-contextual-create",    "dist-chat-contextual-reply",    "dist-chat-source-clarity",    "dist-chat-emoji-express","dist-chat-emoji-recognition",    "dist-chat-emoji-reference-fix","dist-chat-custom-emoji-demo"].some(name=>buildRoot===resolve(import.meta.dirname,"..",name));
    const webCreation=serpCreation||commonsCreation||buildRoot===resolve(import.meta.dirname,"..","dist-chat-web-create");
    const webSearchKey=serpCreation?process.env.SERPAPI_API_KEY:webCreation&&!commonsCreation?process.env.BRAVE_SEARCH_API_KEY:undefined;
    const webCredentialUnavailable=serpCreation?process.env.SERPAPI_CREDENTIAL_STATE==="unreadable":webCreation&&!commonsCreation&&process.env.BRAVE_SEARCH_CREDENTIAL_STATE==="unreadable";
    delete process.env.BRAVE_SEARCH_API_KEY;delete process.env.BRAVE_SEARCH_CREDENTIAL_STATE;
    delete process.env.SERPAPI_API_KEY;delete process.env.SERPAPI_CREDENTIAL_STATE;
    if(!Number.isInteger(port)||port<1024||port>65535)throw new Error("generation-invalid-port");
    const chat=await createLocalChatServer(config.modelKey,{clientRoot:resolve(buildRoot,"client"),interaction:"direct-personal",generation:ongoingPersonalGenerationOptions(),
      sharedDemo:buildRoot===resolve(import.meta.dirname,"..","dist-chat-shared-demo"),
      creationChoices:webCreation||["dist-chat-create-options","dist-chat-express-scope","dist-chat-mixed-create","dist-chat-resilient-create"].some(name=>buildRoot===resolve(import.meta.dirname,"..",name)),
      mixedCreation:webCreation||["dist-chat-mixed-create","dist-chat-resilient-create"].some(name=>buildRoot===resolve(import.meta.dirname,"..",name)),
      emojiExpressions:["dist-chat-shared-demo","dist-chat-live-sync","dist-chat-film-context","dist-chat-style-continuity","dist-chat-compact-explain","dist-chat-visual-inline","dist-chat-emoji-consistent","dist-chat-emoji-inline","dist-chat-emoji-disclosure","dist-chat-emoji-enlarge","dist-chat-demo-polish-fixed","dist-chat-demo-polish","dist-chat-combined-demo","dist-chat-emoji-express","dist-chat-emoji-recognition",      "dist-chat-emoji-reference-fix","dist-chat-custom-emoji-demo"].some(name=>buildRoot===resolve(import.meta.dirname,"..",name)),
            contextualCreation:["dist-chat-shared-demo","dist-chat-live-sync","dist-chat-film-context","dist-chat-style-continuity","dist-chat-compact-explain","dist-chat-visual-inline","dist-chat-emoji-consistent","dist-chat-emoji-inline","dist-chat-emoji-disclosure","dist-chat-emoji-enlarge","dist-chat-demo-polish-fixed","dist-chat-demo-polish","dist-chat-combined-demo","dist-chat-contextual-create","dist-chat-contextual-reply",            "dist-chat-source-clarity",            "dist-chat-emoji-express","dist-chat-emoji-recognition",            "dist-chat-emoji-reference-fix","dist-chat-custom-emoji-demo"].some(name=>buildRoot===resolve(import.meta.dirname,"..",name)),
      webCreation,webProvider:serpCreation?"serpapi":commonsCreation?"commons":"brave",webSearchKey,webCredentialUnavailable,
      sourceDiagnostic:event=>process.stdout.write(JSON.stringify({event:"commons-source-diagnostic",...event})+"\n"),
      semanticCreation:buildRoot===resolve(import.meta.dirname,"..","dist-chat-resilient-create"),
      modelDiagnostic:event=>process.stdout.write(JSON.stringify({event:"model-diagnostic",...event})+"\n")});
    const url=await chat.start(port);
    process.stdout.write(`Personal local chat ready: ${url}/chat; PID ${process.pid}; click-to-run billed AI, no app count/date allowance. Azure service limits and safety boundaries remain.\n`);
    if(buildRoot===resolve(import.meta.dirname,"..","dist-chat-shared-demo"))
      process.stdout.write("Opt-in shared Chat-ID DEMO: anyone knowing an ID can read/change/clear that room. No identity verification. No sensitive content. Still loopback-only; joining and sync make no AI calls.\n");
    for(const signal of ["SIGINT","SIGTERM"])process.once(signal,()=>{void chat.close().then(()=>process.exit(0));});
  }else if(mode.startsWith("image")){
    const {runPersonalImage}=await import("./personal-image.mjs");await runPersonalImage(mode,config.modelKey);
  } else if (mode === "readiness") {
    process.stdout.write(JSON.stringify({
      credentialLoaded: true, scope: config.executionScope, endpoint: config.profile.endpoint,
      deployment: config.profile.deployment, apiVersion: config.profile.apiVersion,
      profileVersion: config.profile.version, production: visualReadiness(config),
      entry: "npm run model:synthetic (four fixed geometric cases; no HTTP listener or Teams login)"
    }, null, 2) + "\n");
  } else if (mode === "synthetic") {
    const report = await runDevelopmentSynthetic(config.modelKey);
    const directory = resolve(".local", "visual-context");
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "synthetic-report.json"), JSON.stringify(report, null, 2) + "\n");
    process.stdout.write(JSON.stringify({ allPassed: report.allPassed, providerRequests: report.providerRequests,
      graphRequests: report.graphRequests, apiVersion: report.apiVersion, report: ".local\\visual-context\\synthetic-report.json" }) + "\n");
    if (!report.allPassed) process.exitCode = 1;
  } else if (mode === "chat") {
    const { createLocalChatServer } = await import(builtUrl("local-chat-server.js"));
    const port=Number(process.env.LOCAL_CHAT_PORT??4317);
    if(!Number.isInteger(port)||port<1024||port>65535)throw new Error("Invalid loopback port");
    const chat = await createLocalChatServer(config.modelKey,{clientRoot:resolve(buildRoot,"client")});
    const url = await chat.start(port);
    process.stdout.write(`Local interactive chat ready: ${url}/chat (owned non-sensitive test content only; explicit consent required)\n`);
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void chat.close().then(() => process.exit(0)); });
  } else {
    // This resource authorizes synthetic development only, never the signed app's processor gate.
    for (const name of ["VISUAL_PROCESSOR_APPROVED", "VISUAL_AUTH_VERIFIED", "VISUAL_GRAPH_VERIFIED", "VISUAL_SHARE_VERIFIED", "VISUAL_FILES_APPROVED"]) process.env[name] = "false";
    for (const name of ["TEST_ONLY_BYPASS_CONNECTOR_AUTH", "ENABLE_STANDALONE_HARNESS", "SKIP_AUTH", "DANGEROUSLY_ALLOW_UNAUTHENTICATED_REQUESTS"]) delete process.env[name];
    process.env.MODEL_CAPABILITY_PROFILE = JSON.stringify(developmentSettings.profile);
    process.env.MEDIA_RESOURCE_LIMITS = JSON.stringify(developmentSettings.mediaLimits);
    await import(builtUrl("index.js"));
  }
  config.modelKey = undefined;
} catch(error) {
  if(mode==="explainprobe"){
    const allowed=["diagnostic-root-mismatch","diagnostic-input-rejected","development-credential-unavailable"];
    process.stderr.write(`Explain probe failed: ${allowed.includes(error?.message)?error.message:"setup-or-browser-failure"}. No provider body logged.\n`);
    process.exitCode=1;
    // The probe owns its disposable server/workers; failure must not leave them listening.
    setTimeout(()=>process.exit(1),100).unref();
  }
  if(/^generation-[a-z-]+$/.test(error?.message??""))process.stderr.write(`Personal image operation blocked: ${error.message}. No automatic retry or allowance refill.\n`);
  process.stderr.write("Local model operation blocked. Check protected credential, profile expiry, build, and (for start) real Teams bot configuration. No provider details logged.\n");
  process.exitCode = 1;
} finally { delete process.env.MODEL_API_KEY; delete process.env.BRAVE_SEARCH_API_KEY; delete process.env.BRAVE_SEARCH_CREDENTIAL_STATE; delete process.env.SERPAPI_API_KEY; delete process.env.SERPAPI_CREDENTIAL_STATE; }
