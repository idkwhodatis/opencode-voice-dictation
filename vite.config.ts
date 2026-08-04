import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

export default defineConfig({
  plugins: [
    monkey({
      entry: "src/index.ts",
      userscript: {
        name: "OpenCode Voice Dictation",
        namespace: "https://github.com/slaid098/opencode-voice-dictation",
        version: "1.0.5",
        description:
          "Voice dictation for OpenCode web using Whisper (Groq API) - works on PC and mobile",
        author: "slaid098",
        match: ["*://*/*"],
        grant: ["GM_xmlhttpRequest", "GM_getValue", "GM_setValue", "GM_registerMenuCommand"],
        connect: ["*"],
        "run-at": "document-idle",
        icon: "https://raw.githubusercontent.com/slaid098/opencode-voice-dictation/main/assets/icon.png",
        updateURL:
          "https://raw.githubusercontent.com/slaid098/opencode-voice-dictation/dist/opencode-voice-dictation.meta.js",
        downloadURL:
          "https://raw.githubusercontent.com/slaid098/opencode-voice-dictation/dist/opencode-voice-dictation.user.js",
      },
      build: {
        fileName: "opencode-voice-dictation.user.js",
        metaFileName: true,
      },
    }),
  ],
});
