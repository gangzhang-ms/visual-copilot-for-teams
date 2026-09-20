import { app, authentication, dialog } from "@microsoft/teams-js";
import type { HostSnapshot, Theme } from "../shared/types";

type Listener = (theme: Theme) => void;
const normalize = (theme?: string): Theme => theme === "dark" ? "dark" : theme === "contrast" ? "contrast" : "default";

export interface HostAdapter {
  initialize(): Promise<HostSnapshot>;
  onThemeChange(listener: Listener): () => void;
  authenticate(bootstrap: string): Promise<string>;
  insert(handle: string, digest: string, appId: string): void;
}

export function createHostAdapter(requireTeams = false): HostAdapter {
  let media: MediaQueryList | undefined;
  let initializedInTeams = false;
  return {
    async initialize() {
      media = window.matchMedia("(prefers-color-scheme: dark)");
      if (window.self === window.top && !requireTeams) return { kind: "standalone", theme: media.matches ? "dark" : "default", showEnglishNotice: true };
      try {
        await Promise.race([app.initialize(), new Promise((_, reject) => window.setTimeout(() => reject(new Error("Teams initialization timeout")), 1500))]);
        const context = await app.getContext();
        initializedInTeams = true;
        return { kind: "teams", theme: normalize(context.app.theme), showEnglishNotice: context.app.locale !== "en-US" };
      } catch {
        if (requireTeams) throw new Error("host-unsupported");
        return { kind: "standalone", theme: media.matches ? "dark" : "default", showEnglishNotice: true };
      }
    },
    authenticate(bootstrap) {
      if (!initializedInTeams) return Promise.reject(new Error("host-unsupported"));
      return authentication.authenticate({ url: `${window.location.origin}/auth/start#bootstrap=${bootstrap}`, width: 600, height: 650 });
    },
    insert(handle, digest, appId) {
      if (!initializedInTeams || !dialog.url.isSupported() || !appId) throw new Error("host-unsupported");
      dialog.url.submit({ handle, digest }, [appId]);
    },
    onThemeChange(listener) {
      if (initializedInTeams) {
        app.registerOnThemeChangeHandler((theme) => listener(normalize(theme)));
        return () => app.registerOnThemeChangeHandler(() => undefined);
      }
      media ??= window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (event: MediaQueryListEvent) => listener(event.matches ? "dark" : "default");
      media.addEventListener("change", handler);
      return () => media?.removeEventListener("change", handler);
    }
  };
}
