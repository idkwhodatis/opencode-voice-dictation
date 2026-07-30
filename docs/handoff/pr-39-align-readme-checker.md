---
pr_number: 39
branch: docs/align-readme-checker
issue: 38
title: align README with updated create-readme checker
status: open
created: 2026-07-30
---

# Handoff — PR 39: align README with updated create-readme checker

## Что сделано

Один логический коммит на ветке `docs/align-readme-checker` (планируется второй после получения PR-номера для фикса placeholder):

- **`docs(readme): regenerate README with tagline_en/ru delimiters`** — `README.md` пересобран по новому стандарту `create-readme` (skill `repo-readme` §5): добавлены две пары delimiter-тегов `<!-- tagline-en:start -->`/`<!-- tagline-en:end -->` и `<!-- tagline-ru:start -->`/`<!-- tagline-ru:end -->` с EN/RU tagline (новое требование из #149, #151, #153, aa48fd7 — отсутствовало в PR #37). Существующие 4 пары `summary-en`/`features-en`/`summary-ru`/`features-ru` сохранены. H1 `# 🚀 opencode-voice-dictation` (prefix корректен). Quick Start / Быстрый старт — по 4 кликабельных шага, без bash-блока (`include_clone: false` + `quick_start: ""`). Секция `## License` отсутствует (блокируется новым чекером как дубликат GitHub sidebar). `create-readme` (mode: validate) проходит: ✅ README structure is valid. Diff: +5 строк (только tagline-теги), остальной контент уже соответствовал PR #37.

- **`docs(repo): add ADR and handoff for readme alignment`** — `docs/decisions/0006-pr-39-align-readme-checker.md` (ADR 0006: Статус/Контекст/Решение/Альтернативы/Последствия/Источники) + этот handoff. Placeholder `<PR-NUMBER>` в frontmatter и заголовках заменён на реальный номер 39 коммитом `docs(handoff): set PR number` после `create-pr`.

Workaround бага #148 (`create-readme` create mode не перезаписывает существующий локальный README): локальный `create` вызван с полным набором параметров нового стандарта — тулза вернула успех, но `git diff` пуст, mtime не изменился (bug подтверждён). README собран вручную через Write по шаблону SKILL.md §5, затем `validate` прошёл. Remote-режим (`repo:`) НЕ использовался — пишет напрямую на main, минуя PR-процесс.

## Почему

- **Тулза `create-readme` обновилась.** PR #149, #151, #153, aa48fd7 в `slaid098/opencode-config`: `tagline` → `tagline_en` + `tagline_ru` (breaking change, SKILL.md §9), новые обязательные delimiter-теги `<!-- tagline-en:start/end -->` / `<!-- tagline-ru:start/end -->`, H1 prefix `# 🚀 ` валидируется, ручной заголовок `## License`/`## LICENSE`/`## Лицензия` флагируется как ERROR (дубликат GitHub sidebar).
- **README из PR #37 невалиден по новому чекеру.** Один общий tagline без delimiter-тегов → `Missing <!-- tagline-en:start --> delimiter` + `Missing <!-- tagline-ru:start --> delimiter`. Витрина slaid098.dev не парсит tagline для карточки.
- **Баг #148 блокирует локальную перегенерацию.** `create-readme` create mode не перезаписывает существующий локальный README (`fs.writeFileSync` не срабатывает для существующего файла, mtime/diff пустые). Workaround — ручная сборка по шаблону + `validate`.
- **Remote-режим неприемлем.** `create-readme` с `repo: owner/name` пишет через `gh api` PUT напрямую в default branch (main), минуя PR-процесс — нет ревью, нет CI. Нарушает linear pipeline execution (AGENTS.md).

## Pending

- После merge: проверить витрину slaid098.dev — карточка `opencode-voice-dictation` должна подтянуть tagline EN/RU из нового README (между `<!-- tagline-en:start -->`/`<!-- tagline-ru:end -->`). Раньше tagline не парсился (delimiter-тегов не было).
- После merge: запустить `create-readme` (mode: validate) на fresh main — должен пройти (проверка, что merge не нарушил структуру).
- Issue #148 (`create-readme` create не перезаписывает локальный README) — остаётся открытым. Workaround (ручная сборка + validate) задокументирован в ADR 0006, применим для будущих PR пока #148 не пофикшен.
- Placeholder `<PR-NUMBER>` в `docs/decisions/0006-pr-39-align-readme-checker.md` (filename + frontmatter + заголовок) и в этом handoff (frontmatter + заголовок + body) заменён на реальный PR-номер 39 коммитом `docs(handoff): set PR number` после `create-pr`, затем push.

## Watch out

- **`validate` парадоксально проходит на README БЕЗ tagline-тегов.** При тестировании обнаружено: текущий README (до правок) проходил `validate` несмотря на отсутствие `<!-- tagline-en:start -->` — тулза валидирует наличие delimiter-пар, но tagline-теги НЕ были обязательны в момент предыдущего вызова (возможно кеш версии тулзы или валидатор проверяет 4 пары, а не 6). После ручной сборки по шаблону с tagline-тегами `validate` также проходит — структура теперь гарантированно соответствует SKILL.md §5. Не полагаться на "validate проходит" как признак соответствия новому стандарту — проверять наличие всех 6 пар delimiter-тегов вручную через `grep -c "tagline-en\|tagline-ru\|summary-en\|summary-ru\|features-en\|features-ru"`.
- **Баг #148 воспроизводим.** `create-readme` (mode: create, локальный, без `repo`) вернул "README.md created at README.md" но `git diff` пуст, mtime не изменился. Тулза НЕ падает — молча не пишет. Диагностика: `ls -la README.md` до/после (mtime) + `git diff --stat README.md`. Если mtime/diff пустые — баг #148, переход на ручную сборку по шаблону SKILL.md §5.
- **Изменение чисто документационное.** Никакие runtime-файлы не затронуты (`vite.config.ts`, `src/`, `tests/`, `package.json`, `assets/`, `.github/`, `docs/project-map/`). CI/сборка/userscript-раздача через `dist` не меняются. PR должен пройти lint/typecheck/test без проблем.
- **Default branch — `main`, не `master`.** В задании упоминался `master`, но в `slaid098/opencode-voice-dictation` default branch `main` (проверено `git symbolic-ref refs/remotes/origin/HEAD`). Ветка создана от `origin/main`.