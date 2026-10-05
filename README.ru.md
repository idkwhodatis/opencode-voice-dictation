# 🚀 OpenCode WebUI Voice Input

[English](README.md) | [Русский](README.ru.md) | [简体中文](README.zh-CN.md)

![Cover](assets/cover.png)

> Голосовой ввод для OpenCode web — кнопка микрофона через Whisper (Groq API)

<!-- summary-ru:start -->
### ❓ Зачем
Нужен был способ диктовать агентам с телефона. Стандартный Android-ввод не удовлетворяет. Встроенного голоса в OpenCode web не было.

### ✅ Что
Два варианта установки для одного и того же голосового ввода OpenCode WebUI:

- **Tampermonkey/Violentmonkey** — самый простой вариант там, где поддерживаются userscripts.
- **Серверная инъекция Caddy + Bun + SQLite** — не зависит от конкретного браузера или устройства и подходит для self-hosted OpenCode за reverse proxy. Работает в любом современном браузере со стандартными API микрофона/медиа без установки userscript или расширения. API-ключ провайдера остаётся на сервере.
<!-- summary-ru:end -->

<!-- features-ru:start -->
### Фичи

| Фича | Описание |
|------|----------|
| 🎤 Микрофон | Нажми 🎤 в поле ввода, говори — текст вставится в промт |
| 🌍 Язык | `ru`, `en` или автоопределение |
| ⚡ Автоотправка | Отправляет транскрипцию агенту после диктовки (опционально) |
| 🧠 Whisper (Groq) | `whisper-large-v3` / `whisper-large-v3-turbo` через Groq API |
| 🌐 Браузеры | Userscript-вариант требует поддержки userscripts; серверная инъекция работает в любом современном браузере и на любом устройстве со стандартными API микрофона/медиа |
| ✅ V2 | Stable и beta DOM проверены по исходникам `907b3bc` / `e5ecb571`; тесты Chromium с моками |
| 🔄 Автообновление | Обновляется сам через `@updateURL` — без ручной переустановки |
| ⌨️ Ctrl+Space | Горячая клавиша на десктопе |
<!-- features-ru:end -->

### ⚡ Вариант A — Tampermonkey

1. Установи [Tampermonkey](https://www.tampermonkey.net/)
2. Получи ключ на [console.groq.com/keys](https://console.groq.com/keys)
3. Открой [ссылку установки скрипта](https://raw.githubusercontent.com/idkwhodatis/opencode-webui-voice-input/master/dist/opencode-voice-dictation.user.js) — скрипт установится в Tampermonkey
4. Dashboard → скрипт → **Settings → Includes/Excludes → User matches → Add**: добавь только свой URL OpenCode, например `https://opencode.example.com/*`. Для конкретного порта localhost используй только точное регулярное выражение в **User includes**: `/^http:\/\/localhost:4096\/.*$/`, заменив порт на свой; User matches игнорирует порт. Удали другие широкие localhost-правила. Сохрани и перезагрузи страницу. При необходимости включи Advanced Config mode.
5. По умолчанию указан несуществующий `https://opencode.invalid/*`: на реальных сайтах скрипт не запускается. Не добавляй `*://*/*`; при обновлении удали старые широкие User matches/includes и отключи отдельную upstream-копию.
6. На разрешённой странице: меню Tampermonkey → **Set Groq API Key**. Ключ, модель, язык и автоотправка сохраняются в GM storage, не в исходниках. Пустой ключ удаляет его.
7. Автоотправка по умолчанию **выключена**. Микрофон / Ctrl+Space: старт и стоп; Cancel: отмена. После стопа запись отправляется Groq или выбранному прокси и может тарифицироваться. Текст добавляется в конец, сохраняя упоминания и вложения. Смена сессии отменяет диктовку. Для микрофона нужен HTTPS или localhost и разрешение браузера.

### 🖥️ Вариант B — серверная инъекция (Caddy + Bun + SQLite)

Этот вариант предназначен для self-hosted OpenCode за Caddy и работает **в современных браузерах на любых устройствах без установки userscript или расширения**.

Bun-сервис держит API-ключ только на сервере, Caddy/Bun добавляет голосовой интерфейс в OpenCode, а модель, язык, prompt, temperature и auto-submit сохраняются в SQLite. Полная инструкция: **[server/README.md](server/README.md)**.

Не включайте одновременно серверную инъекцию и Tampermonkey-скрипт для одного и того же origin.

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

---

## 💬 Поддержка и контакты

👉 **[slaid098.dev/support](https://slaid098.dev/support)**

## Разработка и проверка

```sh
npm ci
npx playwright install chromium
npm run check
```

Для системного Chromium используйте `CHROMIUM_PATH=/path/to/chromium npm run check`. Общая команда запускает lint, проверку типов, поиск мёртвого кода, Vitest с покрытием, воспроизводимую сборку userscript и Chromium-тесты. CI работает с `master` и проверяет, что закоммиченный `dist/` совпадает с исходниками.

Покрываются: размещение и размер кнопки в нативной строке действий на широком и узком экране, tooltip/замена Submit, ленивый/начальный composer, новые/заменённые/переключаемые сессии, защита от двойной инъекции, start/stop/cancel, отказ в доступе к микрофону, очистка ресурсов, HTTP 401/429/5xx, сеть/таймаут, append в rich text и input events, проверки Send/Stop, pagehide/refresh, сохранённая конфигурация и посторонний DOM.

Граница тестирования: браузерные тесты используют собранный скрипт и fixture, похожий на V2, с моками микрофона и Groq. Реальная запись, API-ключ, платный API-вызов, установка расширения, live server, Firefox/mobile и реальное применение Tampermonkey User-match не проверяются.

[Технические решения](docs/decisions/0008-scoped-v2-dictation.md), [поддержка переименованного beta composer](docs/decisions/0009-renamed-beta-composer.md). Исходный проект: [slaid098](https://github.com/slaid098/opencode-voice-dictation).
