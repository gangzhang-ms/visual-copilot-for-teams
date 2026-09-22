import { defineConfig, normalizePath } from "vite";
import { resolve } from "node:path";
const buildRoot=process.env.VISUAL_BUILD_ROOT??"dist";
const extraBuildRoots=["dist-chat-shared-demo","dist-chat-live-sync","dist-chat-film-context","dist-chat-emoji-inline","dist-chat-emoji-consistent","dist-chat-visual-inline","dist-chat-compact-explain","dist-chat-style-continuity"];
if(![...extraBuildRoots,"dist-chat-emoji-disclosure","dist-chat-emoji-enlarge","dist-chat-demo-polish-fixed","dist-chat-demo-polish","dist-chat-combined-demo","dist-chat-custom-emoji-demo","dist-chat-emoji-reference-fix","dist-chat-emoji-recognition","dist-chat-emoji-express","dist-chat-source-clarity","dist-chat-contextual-reply","dist-chat-contextual-create","dist-chat-google-thumbnails","dist-chat-google-create","dist-chat-commons-fix","dist-chat-commons-create","dist-chat-web-create","dist-chat-resilient-create","dist-chat-mixed-create","dist-chat-express-scope","dist-chat-create-options","dist","dist-upgrade","dist-generation-live","dist-local-open","dist-teams-style","dist-chat-expressive","dist-chat-recovery","dist-chat-recovery-check","dist-chat-memes","dist-chat-quick-explain","dist-chat-visual-explain","dist-chat-emoji-explain","dist-chat-media-composer","dist-chat-natural-demo","dist-chat-explain-fix","dist-chat-visual-target","dist-chat-clean-explanation","dist-chat-open-media","dist-chat-clean-ui","dist-chat-unified-express","dist-chat-instant-create","dist-chat-oneclick-create","dist-chat-simple-create","dist-chat-generation-recovery","dist-chat-english","dist-chat-pop-culture-demo","dist-chat-brief-explain","dist-chat-brief-background","dist-chat-source-background"].includes(buildRoot))throw new Error("Unsupported build root");

export default defineConfig({
  build: {
    target: "es2022",
    ssr: true,
    outDir: `${buildRoot}/server`,
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: Object.fromEntries(Object.entries({ index: "src/server/index.ts", "media-worker": "src/server/media-worker.ts", "media-normalizer": "src/server/media-normalizer.ts",
        "development-model": "src/server/development-model.ts", "development-synthetic": "src/server/development-synthetic.ts", "visual-config": "src/server/visual-config.ts",
        "local-chat-server": "src/server/local-chat-server.ts", "commons-image-search":"src/server/commons-image-search.ts", "generated-media-worker":"src/server/generated-media-worker.ts",
        "meme-media-worker":"src/server/meme-media-worker.ts",
        "generated-media-host":"src/server/generated-media-host.ts", "local-generation":"src/server/local-generation.ts",
        "local-generation-config":"src/server/local-generation-config.ts","personal-image":"src/server/personal-image.ts" }).map(([name,path])=>[name,normalizePath(resolve(path))])),
      external: (id) => id.startsWith("node:") || ["@microsoft/teams.apps", "botframework-connector", "@azure/msal-node", "jose", "sharp"].includes(id),
      output: { entryFileNames: "[name].js", chunkFileNames: "[name]-[hash].js" }
    }
  }
});
