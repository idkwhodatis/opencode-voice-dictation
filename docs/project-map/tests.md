---
module: tests
purpose: Unit-тесты (vitest) + моки
key_files:
  - tests/__mocks__/$/index.ts — моки
  - tests/audio.test.ts — тесты audio
  - tests/config.test.ts — тесты config
  - tests/insert.test.ts — тесты insert
  - tests/keyboard.test.ts — тесты keyboard
  - tests/transcribe.test.ts — тесты transcribe
  - tests/ui.test.ts — тесты UI-инъекции кнопки 🎤 (composer-dock, child session, question-dock)
dependencies: [src]
last_updated: 2026-07-26
---

# tests/

## Structure
- `__mocks__/$/index.ts` — моки
- `audio.test.ts` — тесты audio
- `config.test.ts` — тесты config
- `insert.test.ts` — тесты insert
- `keyboard.test.ts` — тесты keyboard
- `transcribe.test.ts` — тесты transcribe
- `ui.test.ts` — тесты UI-инъекции кнопки 🎤 (5 кейсов: dock с prompt-input-v2/prompt-input → кнопка есть; dock без composer / пустой dock / question-dock → кнопки нет). Тестирует через публичный `setupUI` + side-effect (`.ocvd-btn` в DOM), `findComposer` не экспортируется.

## Patterns
- vitest run, 52 теста (6 файлов).
- UI-тесты используют интеграционный подход через `setupUI` + проверку side-effect в DOM (`.ocvd-btn`), т.к. `findComposer` не экспортируется.