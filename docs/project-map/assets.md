---
module: assets
purpose: Статичные ассеты userscript (иконка для @icon)
key_files:
  - assets/icon.png — иконка скрипта 128×128 PNG RGBA, ссылается из vite.config.ts @icon
dependencies: []
last_updated: 2026-07-30
---

# assets/

## Structure
- `icon.png` — иконка userscript 128×128 PNG RGBA (~1.4 КБ). Подхватывается `@icon` в `vite.config.ts` (путь `main/assets/icon.png`), отображается в userscript-менеджерах (Tampermonkey/Violentmonkey). Даунскейл из обложки витрины slaid098.dev.

## Patterns
- Иконка 128×128 — ретина-запас для рендера 16×16/32×32 в менеджерах без оверсамплинга 1024×1024.
- Путь в `@icon` указывает на ветку `main` (raw-URL), файл должен существовать в `main` — не удалять без синхронной правки `vite.config.ts`.