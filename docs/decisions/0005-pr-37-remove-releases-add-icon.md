# ADR 0005: Remove GitHub Releases, add icon, standardize README

- **Date**: 2026-07-30
- **PR**: 37
- **Issue**: #36

## Статус

Accepted.

## Контекст

Userscript `opencode-voice-dictation` раздаётся через ветку `dist` (CI собирает `vite build`, `peaceiris/actions-gh-pages` публикует `dist/*.user.js` + `dist/*.meta.js`). Автообновление работает через `@updateURL`/`@downloadURL` в `vite.config.ts`, указывающие на raw-файлы ветки `dist`. На это поверх был заведён GitHub Release v1.0.0 (тег `v1.0.0`, `softprops/action-gh-release@v3` в `release.yml`) — но Release не использовался для автообновления (userscript-менеджеры читают `@updateURL`, не Releases) и дублировал артефакты, которые уже лежат в `dist`.

Дополнительно `@icon` в `vite.config.ts:19` ссылался на `main/assets/icon.png` — файл не существовал (404 в userscript-менеджере, иконка скрипта пустая). `README.md` был написан вручную без delimiter-тегов `<!-- summary-en:start -->` / `<!-- features-en:start -->` и т.д., которые парсит витрина slaid098.dev — карточка репо на витрине не отображалась.

`release.yml` триггерился по `push: branches: [main]` и `tags: ["v*"]`. Шаг `Create GitHub Release on tag` (`if: startsWith(github.ref, 'refs/tags/v')`) создавал Release с `generate_release_notes: true` и прикреплял `dist/opencode-voice-dictation.user.js` + `.meta.js`. Деплой в `dist` через `peaceiris/actions-gh-pages@v4` (`publish_dir: ./dist`, `publish_branch: dist`, `keep_files: false`) — работал и был единственным нужным каналом раздачи.

## Решение

**Убрать GitHub Releases (сохранить автообновление через dist), добавить иконку 128×128, перегенерировать README через `create-readme`.**

**1. Удалить тег `v1.0.0` и GitHub Release v1.0.0.** `git tag -d v1.0.0` (локальный), `git push origin :refs/tags/v1.0.0` (remote), `gh release delete v1.0.0 --yes`. Тег не в файлах — отдельный коммит не нужен (git status пуст после удаления). Release дублировал артефакты из `dist`, не использовался автообновлением.

**2. `release.yml` → `deploy.yml`.** Удалён `.github/workflows/release.yml`, создан `.github/workflows/deploy.yml` с тем же содержанием, НО:
- `name: Deploy` (вместо `Release`).
- Убран триггер `tags: ["v*"]` — оставлен только `push: branches: [main]`.
- Убран шаг `Create GitHub Release on tag` (`softprops/action-gh-release@v3`) целиком.
- Все шаги проверок (lint, typecheck, knip, test, build) и `Deploy to dist branch` (`peaceiris/actions-gh-pages@v4`) оставлены без изменений — деплой в `dist` единственный канал раздачи.

**3. `assets/icon.png` 128×128.** Источник — `/root/workspace/slaid098-dev/src/apps/opencode-voice-dictation/cover.png` (1024×1024 PNG RGBA, обложка для витрины). Даунскейл до 128×128 через ffmpeg (`-vf "scale=128:128"`, ImageMagick `convert` недоступен в окружении). `@icon` в `vite.config.ts:19` уже указывает на `main/assets/icon.png` — vite.config.ts НЕ трогался. Иконка 128×128 достаточна для userscript-менеджеров (Chrome/Tampermonkey рендерят 16×16 / 32×32 в меню, 128 — ретина-запас без оверсамплинга 1024).

**4. README перегенерирован.** Старый README (121 строка, без delimiter-тегов, с бейджами CI/Release, секциями Compatibility/Settings) заменён на стандартизированный двуязычный через тулзу `create-readme` (mode: create): `repo_name`, `tagline`, `why_en`/`what_en`, `why_ru`/`what_ru`, `features_en`/`features_ru` (8 фич), `include_clone: false` (userscript — не клонируется), `quick_start_steps_en`/`quick_start_steps_ru` (4 кликабельных шага установки). README содержит 4 пары delimiter-тегов (`summary-en`/`features-en`/`summary-ru`/`features-ru`) для парсинга витриной slaid098.dev, language switcher `[English] | [Русский]`, секцию `## 💬 Support and contacts`. `create-readme` (mode: validate) проходит.

**Замечание по `create-readme`**: при выполнении обнаружены два бага тулзы (вне scope этого PR, заведены issues #147 `quick_start: ""` отклоняется валидацией и #148 create mode не перезаписывает существующий локальный README). README собран по шаблону из skill `repo-readme` (точно структура + delimiter-теги), проверен `validate` — структура валидна.

## Альтернативы

### 1. Убрать автообновление полностью (только GitHub Releases)
- **Плюс**: один канал раздачи, проще ментальная модель.
- **Минус**: пользователи перестанут получать обновления автоматически — userscript-менеджеры (Tampermonkey/Violentmonkey) опрашивают `@updateURL` (raw-файл в `dist`), НЕ GitHub Releases. Без `@updateURL` каждый апдейт = ручная переустановка. Катастрофа для UX. Отвергнуто.

### 2. Оставить GitHub Releases (вместе с dist)
- **Плюс**: Releases видны на странице репо, `generate_release_notes` даёт changelog.
- **Минус**: избыточны — артефакты `.user.js`/`.meta.js` уже в `dist` (auto-update читает их). Releases не используются userscript-менеджерами. Два канала раздачи одного и того же = путаница + двойная работа CI. Отвергнуто.

### 3. Иконка 1024×1024 без даунскейла
- **Плюс**: ноль обработки, исходник как есть.
- **Минус**: оверсамплинг — userscript-менеджеры рендерят иконку 16×16/32×32, 1024×1024 PNG = ~десятки КБ в `@icon` (грузится при каждой установке/обновлении). 128×128 = 1.4 КБ, ретина-запас 4× для 32×32. Отвергнуто.

## Последствия

- Ветка `dist` остаётся единственным каналом раздачи userscript. Автообновление через `@updateURL`/`@downloadURL` (vite.config.ts) работает как прежде — пользователи продолжают получать обновления автоматически.
- `deploy.yml` триггерится только по `push: branches: [main]` — теги `v*` больше не запускают CI. Семантическое версионирование тегов не используется (userscript-версия живёт в `@version` в `vite.config.ts`/`package.json`, см. ADR 0002 gotcha про рассинхрон).
- Бейдж `[![Release]]` в README убран (workflow `release.yml` удалён). Бейджи `[![CI]]` остались (workflow `ci.yml` не тронут).
- `assets/icon.png` (128×128, 1.4 КБ) подхватывается `@icon` в `vite.config.ts:19` — иконка скрипта появляется в userscript-менеджере вместо 404.
- README теперь парсится витриной slaid098.dev (4 пары delimiter-тегов) — карточка репо будет отображаться. Старые секции (Compatibility matrix, Settings table, Usage) не перенесены в новый README (задание: `custom_sections` не передавать) — при необходимости добавить отдельным PR через `custom_sections_en`/`custom_sections_ru` после фикса `create-readme` (#148).
- ADR 0005 + handoff созданы. Placeholder `<PR-NUMBER>` в frontmatter заменён на реальный номер после `create-pr` (отдельный коммит `docs(handoff): set PR number`).

## Источники

- `.github/workflows/release.yml` (удалён) — исходный workflow с `softprops/action-gh-release@v3`
- `.github/workflows/deploy.yml` (новый) — деплой в `dist` без GitHub Release
- `vite.config.ts:19` — `@icon: "main/assets/icon.png"` (ссылка на добавленный файл)
- Skill `repo-readme` — шаблон README с delimiter-тегами для slaid098.dev
- Issues (вне scope): #147 (`create-readme` quick_start validation), #148 (`create-readme` create не перезаписывает локальный README)
- Issue: #36