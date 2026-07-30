# 🚀 opencode-voice-dictation
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

---

## 💬 Support and contacts / Поддержка и контакты

👉 **[slaid098.dev/support](https://slaid098.dev/support)**