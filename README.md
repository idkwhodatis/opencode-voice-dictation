# 🚀 opencode-voice-dictation

## 🎤 [安装此 Fork 的语音输入脚本 / Install this fork](https://raw.githubusercontent.com/idkwhodatis/opencode-voice-dictation/master/dist/opencode-voice-dictation.user.js)

安装后请在 Tampermonkey 中仅允许自己的 OpenCode 网址；默认不会在任何真实网站运行。详见下方 [Quick Start](#-quick-start)。

![Cover](assets/cover.png)
<!-- tagline-en:start -->
> Voice dictation for OpenCode web — mic button via Whisper (Groq API)
<!-- tagline-en:end -->
<!-- tagline-ru:start -->
> Голосовой ввод для OpenCode web — кнопка микрофона через Whisper (Groq API)
<!-- tagline-ru:end -->

[English](#-english) | [Русский](#-русский)

---

## 🇺🇸 English

<!-- summary-en:start -->
### ❓ Why
Needed a way to dictate to agents from a phone. Stock Android voice input doesn't cut it. OpenCode web had no built-in voice.

### ✅ What
A Tampermonkey/Violentmonkey userscript — a mic button in the OpenCode web UI. Language selection, auto-submit after dictation. Whisper via Groq API (requires your own key).
<!-- summary-en:end -->

<!-- features-en:start -->
### Features

| Feature | Description |
|---------|-------------|
| 🎤 Mic button | Beside Send, with matching native size and default cursor; click to dictate |
| 🌍 Language | `ru`, `en`, or auto-detect |
| ⚡ Auto-submit | Sends transcription to the agent after dictation (toggleable) |
| 🧠 Whisper (Groq) | `whisper-large-v3` / `whisper-large-v3-turbo` via Groq API |
| 📱 Mobile via Firefox | Firefox supports extensions; mobile Chrome doesn't |
| ✅ Current V2 contract | Stable and renamed beta composer: source-verified at `907b3bc` / `e5ecb571`; mocked Chromium tests |
| 🔄 Auto-update | Updates itself via `@updateURL` — no manual reinstall |
| ⌨️ Ctrl+Space | Desktop hotkey to start/stop recording |
<!-- features-en:end -->

### ⚡ Quick Start

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Get a key at [console.groq.com/keys](https://console.groq.com/keys)
3. Open the [script install link](https://raw.githubusercontent.com/idkwhodatis/opencode-voice-dictation/master/dist/opencode-voice-dictation.user.js) — it installs into Tampermonkey
4. **Important: scope the script before use.** Tampermonkey Dashboard → this script → **Settings** → **Includes/Excludes** → **User matches** → **Add**. Add only your own OpenCode URL pattern, such as `https://opencode.example.com/*`, then **Save** and reload OpenCode. Use your deployment’s real scheme, dedicated host and path prefix. If needed, change the dashboard Config mode to Advanced to see the controls.
5. The shipped match is the reserved, non-resolving `https://opencode.invalid/*`. It intentionally runs on no real site until you add your URL. Do not replace it with `*://*/*`, a generic localhost rule, or an all-sites User include. If upgrading, remove old broad User matches/includes and disable the separately installed upstream script.
6. On the scoped OpenCode page, Tampermonkey menu → **Set Groq API Key**. Enter your own key there, never in this repository. An empty value clears it. **Set Whisper Model**, **Set Language** (empty = automatic, e.g. `zh`), and **Toggle Auto-Submit** use userscript storage and survive refresh/updates.
7. Auto-submit is **OFF by default**. Click the mic or Ctrl+Space to start/stop; Cancel discards pending dictation. Stopping sends your recording to Groq (or your configured proxy) using your key and may incur Groq charges. Review the appended text before Send. Navigating to another session or replacing the editor cancels the operation.

**Port-specific localhost:** Tampermonkey match rules ignore ports. Do **not** rely on a `localhost:4096` User match to isolate that port. Leave User matches at the inert default and add `/^http:\/\/localhost:4096\/.*$/` under **User includes** instead (change the port to yours). Remove any broader localhost User includes/matches. This anchored expression matches only that scheme, host and port. [Official port-matching notes](https://www.tampermonkey.net/changelog.php?locale=en&more=true&show=gcal).

Microphone access requires HTTPS or localhost and browser permission. The script requests it only when you start recording. The V2 editor preserves existing text, mention nodes and attachments. The generic home screen and disabled child-session composer have no mic until an editable composer appears. [Tampermonkey scope instructions](https://www.tampermonkey.net/faq.php?locale=en#Q103).

### 🌐 Custom STT Endpoint

Groq may block direct requests from some networks. Point the script at your own nginx proxy:

1. Deploy an nginx reverse proxy that forwards to `api.groq.com`:
   ```nginx
   location / {
       proxy_pass https://api.groq.com:443;
       proxy_set_header Host api.groq.com;
   }
   ```
2. Tampermonkey menu → **Set STT Endpoint** → paste `https://your-domain.com/openai/v1/audio/transcriptions`
3. Requests now go through your trusted HTTPS proxy, which receives both your recording and API key. The menu asks you to confirm that destination. `@connect *` preserves custom proxy support; it does **not** enable the script on all websites. Page execution remains limited by User matches.

A path prefix is not needed if the domain is dedicated to Groq. The `/groq` variant stays valid for multi-proxy domains — `location /groq/` with a trailing slash strips the prefix.

### 🌡️ Temperature

Whisper may hallucinate on silence/noise. **Set Temperature** (default `0` = deterministic, range `0`–`1`) reduces hallucinations.

### 🌐 Wrong Language (English instead of Russian)

If the model returns English text for Russian audio, clear the Whisper Prompt:

1. Open Tampermonkey/Violentmonkey menu → **Set Whisper Prompt**
2. Leave the field empty (delete all text)
3. Confirm

The prompt biases the model toward the prompt's language. An English prompt with Russian audio causes the model to output English. The prompt should match the audio language (or be empty for auto-detect).

---

## 🇷🇺 Русский

<!-- summary-ru:start -->
### ❓ Зачем
Нужен был способ диктовать агентам с телефона. Стандартный Android-ввод не удовлетворяет. Встроенного голоса в OpenCode web не было.

### ✅ Что
Скрипт для Tampermonkey/Violentmonkey — кнопка микрофона в веб-интерфейсе OpenCode. Выбор языка, автоотправка после диктовки. Whisper через Groq API (нужен свой ключ).
<!-- summary-ru:end -->

<!-- features-ru:start -->
### Фичи

| Фича | Описание |
|------|----------|
| 🎤 Микрофон | Нажми 🎤 в поле ввода, говори — текст вставится в промт |
| 🌍 Язык | `ru`, `en` или автоопределение |
| ⚡ Автоотправка | Отправляет транскрипцию агенту после диктовки (опционально) |
| 🧠 Whisper (Groq) | `whisper-large-v3` / `whisper-large-v3-turbo` через Groq API |
| 📱 Мобайл через Firefox | Firefox поддерживает расширения; mobile Chrome — нет |
| ✅ V2 | Stable и beta DOM проверены по исходникам `907b3bc` / `e5ecb571`; тесты Chromium с моками |
| 🔄 Автообновление | Обновляется сам через `@updateURL` — без ручной переустановки |
| ⌨️ Ctrl+Space | Горячая клавиша на десктопе |
<!-- features-ru:end -->

### ⚡ Быстрый старт

1. Установи [Tampermonkey](https://www.tampermonkey.net/)
2. Получи ключ на [console.groq.com/keys](https://console.groq.com/keys)
3. Открой [ссылку установки скрипта](https://raw.githubusercontent.com/idkwhodatis/opencode-voice-dictation/master/dist/opencode-voice-dictation.user.js) — скрипт установится в Tampermonkey
4. Dashboard → скрипт → **Settings → Includes/Excludes → User matches → Add**: добавь только свой URL OpenCode, например `https://opencode.example.com/*`. Для конкретного порта localhost используй только точное регулярное выражение в **User includes**: `/^http:\/\/localhost:4096\/.*$/`, заменив порт на свой; User matches игнорирует порт. Удали другие широкие localhost-правила. Сохрани и перезагрузи страницу. При необходимости включи Advanced Config mode.
5. По умолчанию указан несуществующий `https://opencode.invalid/*`: на реальных сайтах скрипт не запускается. Не добавляй `*://*/*`; при обновлении удали старые широкие User matches/includes и отключи отдельную upstream-копию.
6. На разрешённой странице: меню Tampermonkey → **Set Groq API Key**. Ключ, модель, язык и автоотправка сохраняются в GM storage, не в исходниках. Пустой ключ удаляет его.
7. Автоотправка по умолчанию **выключена**. Микрофон / Ctrl+Space: старт и стоп; Cancel: отмена. После стопа запись отправляется Groq или выбранному прокси и может тарифицироваться. Текст добавляется в конец, сохраняя упоминания и вложения. Смена сессии отменяет диктовку. Для микрофона нужен HTTPS или localhost и разрешение браузера.

### 🌐 Кастомный STT endpoint

Groq может блокировать прямые запросы из некоторых сетей. Направь скрипт на свой nginx-прокси:

1. Разверни nginx reverse proxy, который форвардит на `api.groq.com`:
   ```nginx
   location / {
       proxy_pass https://api.groq.com:443;
       proxy_set_header Host api.groq.com;
   }
   ```
2. Меню Tampermonkey → **Set STT Endpoint** → вставь `https://your-domain.com/openai/v1/audio/transcriptions`
3. Используй только доверенный HTTPS-прокси: он получает запись и API-ключ. Меню запрашивает подтверждение адреса. `@connect *` разрешает сетевые запросы к прокси, но не запуск скрипта на всех сайтах.

Префикс пути не нужен, если домен выделен только под Groq. `/groq`-вариант остаётся валидным для мульти-прокси доменов — `location /groq/` с trailing slash срезает префикс.

### 🌡️ Temperature

Whisper может галлюцинировать на тишине/шуме. **Set Temperature** (по умолчанию `0` = детерминированный вывод, диапазон `0`–`1`) снижает галлюцинации.

### 🌐 Неправильный язык (английский вместо русского)

Если модель возвращает английский текст для русской речи, очистите Whisper Prompt:

1. Откройте меню Tampermonkey/Violentmonkey → **Set Whisper Prompt**
2. Оставьте поле пустым (удалите весь текст)
3. Подтвердите

Промпт смещает модель к языку промпта. Английский промпт с русским аудио заставляет модель выводить английский. Промпт должен совпадать с языком аудио (или быть пустым для автоопределения).

---

## 💬 Support and contacts / Поддержка и контакты

👉 **[slaid098.dev/support](https://slaid098.dev/support)**

## Development and verification

```sh
npm ci
npx playwright install chromium
npm run check
```

For a system Chromium, use `CHROMIUM_PATH=/path/to/chromium npm run check`. The aggregate command runs lint, types, dead-code checks, Vitest with coverage, a reproducible userscript build and Chromium tests. CI targets `master` and verifies that committed `dist/` matches source. GitHub forks may require the owner to enable Actions once under the repository's Actions tab.

Covered: native action-row placement and sizing at desktop/narrow widths, tooltip/Submit replacement, lazy/initial composer, new/replaced/switching sessions, duplicate injection, start/stop/cancel (including pending microphone permission and HTTP requests), denied microphone, resource cleanup, HTTP 401/429/5xx, network/timeout, rich-text append and input events, optional Send/Stop guards, pagehide/refresh cleanup, persisted configuration, and inert metadata/unrelated DOM.

Boundary: browser tests use the built script and a source-shaped V2 fixture, with mocked microphone and Groq. No real recording, API key, paid API call, extension installation, live server, Firefox/mobile, or actual Tampermonkey User-match enforcement was exercised. After installing, check the script is absent on an unrelated site, appears on your scoped OpenCode URL, and persists settings after reload. Keep auto-submit off for your first test.

[Source details and decisions](docs/decisions/0008-scoped-v2-dictation.md), [renamed beta composer support](docs/decisions/0009-renamed-beta-composer.md). Original project by [slaid098](https://github.com/slaid098/opencode-voice-dictation); this fork's install and update files remain on `idkwhodatis/master`.
