# ADR 0007: Empty whisperPrompt default (PR #46)

- **Date**: 2026-08-04
- **PR**: 46
- **Issue**: #46

## Статус

Accepted.

## Контекст

PR #43 добавил `DEFAULTS.whisperPrompt` — 107-символьный английский список терминов (`opencode, voice, dictation, transcribe, command, terminal, commit, branch, pull, push, merge, issue, prompt`). Целью было biasing-смещение модели в сторону технической терминологии userscript-а.

Документация Groq для параметра `prompt` (Whisper API) явно указывает: «Use the same language as the language of the audio file». Параметр `prompt` — это не системный промпт, а seed-контекст для декодера: модель стремится продолжить стиль и язык промпта в транскрипции.

Практический баг: английский промпт + русский аудио = модель уводит транскрипт в английский. Особенно заметно на `whisper-large-v3-turbo` (turbo более чувствителен к prompt biasing). Пользователь подтвердил: `language=ru` + turbo всё равно возвращает английский текст, потому что английский промпт перебивает явный `language` параметр.

## Решение

**`DEFAULTS.whisperPrompt = ""` (пустая строка).**

Поле `whisperPrompt` в `AppConfig` остаётся. Menu command `Set Whisper Prompt` (`registerMenuCommands`) остаётся — пользователи с узкопрофильной терминологией (медицина, право, конкретный стек) могут задать свой промпт на нужном языке. Меняется только default: пустая строка вместо английского biasing-промпта.

## Последствия

- `buildFormData` в `src/transcribe.ts` использует falsy-check `if (config.whisperPrompt)` — пустая строка не отправляет поле `prompt` в Groq API вообще. Модель работает в чистом auto-detect режиме без prompt biasing.
- Обратная совместимость: существующие юзеры, установившие скрипт в версии 1.0.4 (PR #43) и не менявшие `whisperPrompt` через меню, имеют в `GM_getValue("whisperPrompt")` старое 107-символьное значение — оно сохранится и продолжит отправляться. Новый default применяется только к свежим установкам и к юзерам, очистившим поле через `Set Whisper Prompt`.
- README обновлён секцией troubleshooting «Wrong Language» (EN+RU) — инструкция очистить Whisper Prompt через меню.
- Версия bumped 1.0.4 → 1.0.5 (vite.config.ts + package.json).

## Альтернативы

### 1. Двуязычный промпт (английский + русский термины)
- **Плюс**: biasing в обе стороны.
- **Минус**: усложнение. Промпт нужно поддерживать при добавлении новых языков (сейчас `language` поддерживает `ru`/`en`/`auto`). При `auto` модель может растеряться от двуязычного промпта. Отвергнуто.

### 2. Смена модели на turbo по умолчанию
- **Плюс**: turbo быстрее.
- **Минус**: баг был в промпте, не в модели. `whisper-large-v3` лучше для русского (точность выше, turbo оптимизирован под английский). Смена модели не решила бы проблему английского biasing-а. Отвергнуто.

## Источники

- `src/config.ts` — `DEFAULTS.whisperPrompt` до/после
- `src/transcribe.ts` — `buildFormData` falsy-check `if (config.whisperPrompt)`
- Groq Whisper API docs — `prompt` parameter: «Use the same language as the language of the audio file»
- PR #43 — добавление `DEFAULTS.whisperPrompt` (107 символов)
- Issue: #46