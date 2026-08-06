# 🚀 opencode-voice-dictation
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
| 🎤 Mic button | Click 🎤 in the input area, speak — text inserts into the prompt |
| 🌍 Language | `ru`, `en`, or auto-detect |
| ⚡ Auto-submit | Sends transcription to the agent after dictation (toggleable) |
| 🧠 Whisper (Groq) | `whisper-large-v3` / `whisper-large-v3-turbo` via Groq API |
| 📱 Mobile via Firefox | Firefox supports extensions; mobile Chrome doesn't |
| ✅ Tested on 1.18.8 | Older versions via fallback selectors; needs "New UI" toggle |
| 🔄 Auto-update | Updates itself via `@updateURL` — no manual reinstall |
| ⌨️ Ctrl+Space | Desktop hotkey to start/stop recording |
<!-- features-en:end -->

### ⚡ Quick Start

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Get a key at [console.groq.com/keys](https://console.groq.com/keys)
3. Open the [script install link](https://raw.githubusercontent.com/slaid098/opencode-voice-dictation/dist/opencode-voice-dictation.user.js) — it installs into Tampermonkey
4. Tampermonkey menu → **Set Groq API Key** → paste `gsk_...`

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
3. Requests now go through your proxy. The userscript metadata uses `@connect *`, so any domain is allowed.

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
| ✅ Проверено на 1.18.8 | Старые версии через fallback-селекторы; нужен «New UI» |
| 🔄 Автообновление | Обновляется сам через `@updateURL` — без ручной переустановки |
| ⌨️ Ctrl+Space | Горячая клавиша на десктопе |
<!-- features-ru:end -->

### ⚡ Быстрый старт

1. Установи [Tampermonkey](https://www.tampermonkey.net/)
2. Получи ключ на [console.groq.com/keys](https://console.groq.com/keys)
3. Открой [ссылку установки скрипта](https://raw.githubusercontent.com/slaid098/opencode-voice-dictation/dist/opencode-voice-dictation.user.js) — скрипт установится в Tampermonkey
4. Меню Tampermonkey → **Set Groq API Key** → вставь `gsk_...`

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
3. Запросы пойдут через твой прокси. Метаблок юзерскрипта использует `@connect *`, поэтому разрешён любой домен.

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