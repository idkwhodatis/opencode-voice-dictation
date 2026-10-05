import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

export default defineConfig({
  plugins: [
    monkey({
      entry: "src/index.ts",
      userscript: {
        name: "OpenCode Voice Dictation",
        namespace: "https://github.com/idkwhodatis/opencode-voice-dictation",
        version: "1.1.2",
        description:
          "Voice dictation for OpenCode web using Whisper (Groq API) - works on PC and mobile",
        author: "slaid098",
        // Reserved non-resolving host: users explicitly add their own URL in User matches.
        match: ["https://opencode.invalid/*"],
        noframes: true,
        grant: [
          "GM_xmlhttpRequest",
          "GM_getValue",
          "GM_setValue",
          "GM_registerMenuCommand",
          "window.onurlchange",
        ],
        connect: ["*"],
        "run-at": "document-idle",
        icon: "https://raw.githubusercontent.com/idkwhodatis/opencode-voice-dictation/master/assets/icon.png",
        updateURL:
          "https://raw.githubusercontent.com/idkwhodatis/opencode-voice-dictation/master/dist/opencode-voice-dictation.meta.js",
        downloadURL:
          "https://raw.githubusercontent.com/idkwhodatis/opencode-voice-dictation/master/dist/opencode-voice-dictation.user.js",
      },
      build: {
        fileName: "opencode-voice-dictation.user.js",
        metaFileName: true,
      },
    }),
  ],
});
