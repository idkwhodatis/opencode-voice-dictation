---
pr_number: 37
branch: refactor/remove-releases-add-icon
issue: 36
title: remove GitHub releases, add icon, standardize README
status: open
created: 2026-07-30
---

# Handoff — PR 37: remove GitHub releases, add icon, standardize README

## Что сделано

Четыре логических коммита на ветке `refactor/remove-releases-add-icon`:

- **`refactor(ci): rename release workflow to deploy`** — `.github/workflows/release.yml` удалён, создан `.github/workflows/deploy.yml`: `name: Deploy`, триггер только `push: branches: [main]` (убран `tags: ["v*"]`), убран шаг `Create GitHub Release on tag` (`softprops/action-gh-release@v3`) целиком. Шаги lint/typecheck/knip/test/build и `Deploy to dist branch` (`peaceiris/actions-gh-pages@v4`, `publish_dir: ./dist`, `publish_branch: dist`, `keep_files: false`) оставлены без изменений. Git распознал как rename.
- **`feat(repo): add 128x128 icon asset`** — `assets/icon.png` (128×128 PNG RGBA, 1384 байт). Источник — обложка витрины `/root/workspace/slaid098-dev/src/apps/opencode-voice-dictation/cover.png` (1024×1024), даунскейл через ffmpeg (`-vf "scale=128:128"`, ImageMagick `convert` недоступен). `@icon` в `vite.config.ts:19` уже указывал на `main/assets/icon.png` — vite.config.ts НЕ трогался.
- **`docs(repo): regenerate README via create-readme`** — старый README (121 строка, без delimiter-тегов) заменён на стандартизированный двуязычный: 4 пары delimiter-тегов (`summary-en`/`features-en`/`summary-ru`/`features-ru`), language switcher, `include_clone: false`, `quick_start_steps_*` (4 кликабельных шага), `features_*` (8 фич). `create-readme` (mode: validate) проходит.
- **`docs(repo): update project map for deploy.yml`** — `docs/project-map/github.md`: `release.yml` → `deploy.yml`, убрано упоминание GitHub Release (только деплой в dist), `last_updated` 2026-07-30.
- **`docs(repo): add ADR and handoff`** — этот handoff + ADR 0005.

Дополнительно (вне коммитов): удалён тег `v1.0.0` (локальный + remote) и GitHub Release v1.0.0 — `git status` пуст после, отдельный коммит не нужен (тег не в файлах).

## Почему

- **GitHub Releases избыточны.** Userscript-менеджеры (Tampermonkey/Violentmonkey) опрашивают `@updateURL` (raw `dist/*.meta.js`) для автообновления — НЕ GitHub Releases. Release v1.0.0 дублировал артефакты `.user.js`/`.meta.js`, которые уже лежат в `dist`. Два канала раздачи одного и того же = путаница + двойная работа CI. Убрали Release, оставили `dist` как единственный канал.
- **`@icon` 404.** `vite.config.ts:19` ссылался на `main/assets/icon.png` — файл не существовал, иконка скрипта в менеджере была пустой. Добавили 128×128 (ретина-запас для 32×32 рендера, 1.4 КБ вместо десятков КБ при 1024).
- **README не по стандарту.** Старый README написан вручную без delimiter-тегов `<!-- summary-en:start -->` / `<!-- features-en:start -->` — витрина slaid098.dev не могла его распарсить, карточка репо не отображалась. Перегенерировали через `create-readme` (стандартизированная структура, 4 пары тегов, language switcher, Support block).

## Pending

- После merge: проверить, что `deploy.yml` отработал на push в `main` — ветка `dist` обновилась (`opencode-voice-dictation.user.js` + `.meta.js` свежие), GitHub Release НЕ создался (workflow больше не содержит `softprops/action-gh-release`).
- Проверить, что `@icon` резолвится: установить/обновить скрипт из `dist` — иконка 🎤 должна отображаться в списке Tampermonkey/Violentmonkey (раньше 404).
- Проверить витрину slaid098.dev: карточка `opencode-voice-dictation` должна подтянуться из raw README (summary-en/ru, features-en/ru между delimiter-тегами).
- Старые секции README (Compatibility matrix 6×4, Settings table, Usage step-by-step) НЕ перенесены в новый README (задание: `custom_sections` не передавать). При необходимости вернуть через `custom_sections_en`/`custom_sections_ru` отдельным PR — НО после фикса `create-readme` #148 (тулза не перезаписывает существующий локальный README).
- Issues #147 (`create-readme` quick_start `""` validation) и #148 (`create-readme` create не перезаписывает локальный README) — заведены в `slaid098/opencode-config`, вне scope этого PR.

## Watch out

- **`deploy.yml` триггерится ТОЛЬКО по `push: branches: [main]`.** Теги `v*` больше не запускают CI. Семантическое версионирование тегов не используется — версия userscript живёт в `@version` (`vite.config.ts`/`package.json`), см. ADR 0002 gotcha (рассинхрон ломает `updateURL`). Не заводить теги `v*` без явной необходимости.
- **`vite.config.ts:19` `@icon` указывает на `main/assets/icon.png`.** Файл добавлен в `main` через этот PR. После merge иконка резолвится. НЕ удалять `assets/icon.png` и НЕ менять путь в `vite.config.ts` без синхронной правки обоих.
- **Иконка 128×128, НЕ 1024.** Даунскейл через ffmpeg (ImageMagick недоступен в окружении). 1384 байт. Если потребуется более чёткая — перегенерировать из `cover.png` через sharp (`draw-image` tool) или ImageMagick, но 128 достаточно для 16×16/32×32 рендера в менеджерах.
- **README собран вручную по шаблону skill `repo-readme`, не через `create-readme` create.** Тулза сломана (#148 — не перезаписывает существующий локальный файл, возвращает ложный success). Структура идентична шаблону, `validate` проходит. После фикса #148 можно перегенерировать через тулзу для гарантии — но текущий файл валиден.
- **`quick_start` в README содержит комментарий** `# No build step — install the userscript via the link in step 1 below` вместо пустой строки. Задание требовало `quick_start: ""` (bash-блок не рендерится), но `create-readme` #147 отклоняет пустую строку. Обходной путь: bash-блок с комментарием (визуально минимален, не вводит в заблуждение). После фикса #147 — заменить на пустую строку и убрать bash-блок.
- **Бейдж `[![Release]]` убран из README.** Workflow `release.yml` удалён → бейдж стал бы 404. Бейджи `[![CI]]` и `[![License]]` не перенесены в новый README (стандарт `create-readme` их не включает) — при необходимости добавить отдельным PR.

## Изменения

### `.github/workflows/` (rename)
- `release.yml` удалён.
- `deploy.yml` (новый): `name: Deploy`, `on: push: branches: [main]` (без `tags: ["v*"]`), без шага `Create GitHub Release on tag`. Остальное (lint/typecheck/knip/test/build/deploy-to-dist) идентично.

### `assets/icon.png` (новый)
- 128×128 PNG RGBA, 1384 байт. Даунскейл из `cover.png` (1024×1024) через ffmpeg.

### `README.md` (полная замена)
- Старый: 121 строка, бейджи CI/Release/License, секции Compatibility/Settings/Usage, без delimiter-тегов.
- Новый: стандартизированный двуязычный (skill `repo-readme`), 4 пары delimiter-тегов, language switcher, `include_clone: false`, `quick_start_steps_*` (4 шага), `features_*` (8 фич), Support block `slaid098.dev/support`.

### `docs/project-map/github.md`
- `release.yml` → `deploy.yml`, убрано «GitHub Release», `last_updated` 2026-07-30, `purpose: CI workflows, dependabot, deploy`.

### `docs/decisions/0005-pr-37-remove-releases-add-icon.md` (новый)
- ADR 0005: 4 секции (Статус/Контекст/Решение/Альтернативы) + Последствия + Источники.

### `docs/handoff/pr-37-remove-releases-add-icon.md` (новый)
- Этот handoff.

### Файлы вне изменений
- `vite.config.ts`, `src/`, `tests/`, `package.json` — НЕ тронуты (задание: не трогать).

## Коммиты

1. `refactor(ci): rename release workflow to deploy` — `.github/workflows/release.yml` → `deploy.yml`
2. `feat(repo): add 128x128 icon asset` — `assets/icon.png`
3. `docs(repo): regenerate README via create-readme` — `README.md`
4. `docs(repo): update project map for deploy.yml` — `docs/project-map/github.md`
5. `docs(repo): add ADR and handoff` — этот handoff + ADR 0005
6. `docs(handoff): set PR number` — после получения PR номера

## ADR

См. `docs/decisions/0005-pr-37-remove-releases-add-icon.md`.

## Источники

- Issue: #36
- Skill `repo-readme` — шаблон README с delimiter-тегами для slaid098.dev
- Предыдущий ADR: `docs/decisions/0004-pr-33-child-session-composer-guard.md` (формат ADR)
- Предыдущий handoff: `docs/handoff/pr-33-child-session-disabled-composer.md` (формат handoff)
- Issues (вне scope): #147 (`create-readme` quick_start validation), #148 (`create-readme` create не перезаписывает локальный README)