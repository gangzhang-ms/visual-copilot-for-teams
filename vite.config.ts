import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const buildRoot=process.env.VISUAL_BUILD_ROOT??"dist";
const extraBuildRoots=["dist-chat-shared-demo","dist-chat-live-sync","dist-chat-film-context","dist-chat-emoji-inline","dist-chat-emoji-consistent","dist-chat-visual-inline","dist-chat-compact-explain","dist-chat-style-continuity"];
if(![...extraBuildRoots,"dist-chat-emoji-disclosure","dist-chat-emoji-enlarge","dist-chat-demo-polish-fixed","dist-chat-demo-polish","dist-chat-combined-demo","dist-chat-custom-emoji-demo","dist-chat-emoji-reference-fix","dist-chat-emoji-recognition","dist-chat-emoji-express","dist-chat-source-clarity","dist-chat-contextual-reply","dist-chat-contextual-create","dist-chat-google-thumbnails","dist-chat-google-create","dist-chat-commons-fix","dist-chat-commons-create","dist-chat-web-create","dist-chat-resilient-create","dist-chat-mixed-create","dist-chat-express-scope","dist-chat-create-options","dist","dist-upgrade","dist-generation-live","dist-local-open","dist-teams-style","dist-chat-expressive","dist-chat-recovery","dist-chat-recovery-check","dist-chat-memes","dist-chat-quick-explain","dist-chat-visual-explain","dist-chat-emoji-explain","dist-chat-media-composer","dist-chat-natural-demo","dist-chat-explain-fix","dist-chat-visual-target","dist-chat-clean-explanation","dist-chat-open-media","dist-chat-clean-ui","dist-chat-unified-express","dist-chat-instant-create","dist-chat-oneclick-create","dist-chat-simple-create","dist-chat-generation-recovery","dist-chat-english","dist-chat-pop-culture-demo","dist-chat-brief-explain","dist-chat-brief-background","dist-chat-source-background"].includes(buildRoot))throw new Error("Unsupported build root");

export default defineConfig({
  base: "/",
  plugins: [react()],
  build: {
    outDir: `${buildRoot}/client`,
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: false,
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: { index: "index.html", "dialog-entry": "src/client/dialog-entry.tsx", "auth-entry": "src/client/auth-entry.ts", "local-chat": "local-chat.html" },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/chunk-[hash].js",
        assetFileNames: (asset) => asset.name?.includes("local-chat") && asset.name.endsWith(".css") ? "assets/local-chat.css" : asset.name?.endsWith(".css") ? "assets/dialog.css" : "assets/[name]-[hash][extname]"
      }
    }
  },
  server: {
    fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.local/**", "**/*.dpapi"] },
    proxy: { "/api": "http://127.0.0.1:3978", "/healthz": "http://127.0.0.1:3978", "/dialog": "http://127.0.0.1:3978", "/dialog-bootstrap.js": "http://127.0.0.1:3978" }
  }
});
