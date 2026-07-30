# ADR 0006: Align README with updated create-readme checker

- **Date**: 2026-07-30
- **PR**: 39
- **Issue**: #38

## Статус

Accepted.

## Контекст

Тулза `create-readme` (в `slaid098/opencode-config`) обновилась серией коммитов и PR (#149, #151, #153, aa48fd7): новые требования валидатора — `tagline_en`/`tagline_ru` как обязательные параметры с собственными delimiter-тегами `<!-- tagline-en:start/end -->` и `<!-- tagline-ru:start/end -->`, H1 title с prefix `# 🚀 `, блок ручного заголовка `## License`/`## LICENSE`/`## Лицензия` как ERROR (дубликат GitHub sidebar). README, сгенерированный в PR #37 (ADR 0005), использует старый стандарт — один общий tagline без delimiter-тегов — и не прошёл бы новый `validate` (`Missing <!-- tagline-en:start --> delimiter`, `Missing <!-- tagline-ru:start --> delimiter`).

Баг #148 в `create-readme` (create mode не перезаписывает существующий локальный README через `fs.writeFileSync` — `git status` пуст после вызова, mtime не меняется) делает локальную перегенерацию невозможной. Remote-режим тулзы (`repo: owner/name`) обходит #148 (пишет через `gh api` PUT с base64+SHA), но пишет напрямую в default branch (main), минуя PR-процесс — неприемлемо для ревью-флоу.

## Решение

**Перегенерировать README по новому стандарту вручную по шаблону skill `repo-readme` §5, обойдя баг #148 через ручную сборку + `validate`.**

**1. Сначала протестирован локальный режим `create-readme` (mode: create, без `repo`).** Вызов с полным набором параметров нового стандарта (`tagline_en`/`tagline_ru`, `why_en`/`what_en`, `why_ru`/`what_ru`, `features_en`/`features_ru`, `include_clone: false`, `quick_start: ""`, `quick_start_steps_en`/`quick_start_steps_ru`). Тулза вернула успех, но `git diff` пуст, `ls -la README.md` mtime не изменился — баг #148 подтверждён на этом репо.

**2. Ручная сборка README по шаблону SKILL.md §5.** README.md пересобран через Write с точной структурой нового стандарта: H1 `# 🚀 opencode-voice-dictation`, две пары `tagline-en`/`tagline-ru` delimiter-тегов (новое, отсутствовало в PR #37), четыре пары `summary-en`/`features-en`/`summary-ru`/`features-ru` (уже были), language switcher `[English](#-english) | [Русский](#-русский)`, Quick Start / Быстрый старт (4 кликабельных шага каждый, без bash-блока — `include_clone: false` + `quick_start: ""`), секция `## 💬 Support and contacts`. Секция `## License` отсутствует (блокируется новым чекером как дубликат GitHub sidebar). Контент tagline/why/what/features идентичен параметрам, переданным в `create-readme`.

**3. `create-readme` (mode: validate) прошёл.** ✅ README structure is valid — все 6 пар delimiter-тегов (tagline + summary + features × EN/RU) присутствуют, H1 prefix корректен, support-ссылка на месте, License-секции нет.

**4. Diff минимален.** Только 5 строк добавлено (tagline delimiter-теги + RU tagline), остальной контент уже соответствовал стандарту PR #37. Никакие другие файлы не тронуты (`vite.config.ts`, `src/`, `tests/`, `package.json`, `assets/`, `.github/`, `docs/project-map/` — нетронуты).

## Альтернативы

### 1. Remote-режим `create-readme` (`repo: "slaid098/opencode-voice-dictation"`)
- **Плюс**: обходит баг #148 (пишет через `gh api repos/{owner}/{repo}/contents/README.md` PUT с base64+SHA).
- **Минус**: пишет напрямую в default branch (main) через GitHub API, минуя PR-процесс — нет ревью, нет CI-проверок, прямой коммит на main. Нарушает linear pipeline execution (AGENTS.md). Отвергнуто.

### 2. Ждать фикса бага #148 в `create-readme`
- **Плюс**: потом локальный `create` сработает сам, ручная сборка не нужна.
- **Минус**: блокирует работу — issue #38 требует выровнять README сейчас (PR #37 README невалиден по новому чекеру). Сроки фикса #148 неизвестны. Отвергнуто.

### 3. Оставить старый README (из PR #37) без tagline delimiter-тегов
- **Плюс**: ноль работы.
- **Минус**: не прошёл бы новый `validate` (`Missing <!-- tagline-en:start --> delimiter`). Витрина slaid098.dev не сможет распарсить tagline для карточки. Отвергнуто.

## Последствия

- README теперь соответствует новому стандарту `create-readme` (6 пар delimiter-тегов: tagline-en/ru + summary-en/ru + features-en/ru). Витрина slaid098.dev парсит все 6 фрагментов — tagline EN/RU для карточки, summary/features для деталей.
- `validate` проходит. Будущие правки README должны сохранять все 6 пар delimiter-тегов — после ручных правок обязательна re-валидация через `create-readme` (mode: validate).
- Баг #148 остаётся открытым — локальный `create` всё ещё не перезаписывает существующий README. Workaround (ручная сборка + validate) задокументирован здесь, применим для будущих PR пока #148 не пофикшен.
- Никакие runtime-файлы не затронуты — изменение чисто документационное, CI/сборка/userscript-раздача не меняются.
- ADR 0006 + handoff созданы. Placeholder `<PR-NUMBER>` в frontmatter заменён на реальный номер после `create-pr` (отдельный коммит `docs(handoff): set PR number`).

## Источники

- `README.md` (до/после) — diff: +5 строк (tagline-en/ru delimiter-теги)
- Skill `repo-readme` SKILL.md §5 — шаблон README с delimiter-тегами
- Skill `repo-readme` SKILL.md §9 — breaking change: `tagline` → `tagline_en` + `tagline_ru`
- `create-readme` tool — mode: create (локальный режим, баг #148 подтверждён), mode: validate (проходит)
- Issues (вне scope): #147 (`create-readme` quick_start `""` validation — пофикшен, bash-блок не рендерится), #148 (`create-readme` create не перезаписывает локальный README — обход через ручную сборку)
- PR #37 / ADR 0005 — предыдущая регенерация README (старый стандарт, без tagline delimiter-тегов)
- Issue: #38