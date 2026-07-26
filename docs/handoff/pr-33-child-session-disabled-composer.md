---
pr_number: 33
branch: fix/ui/child-session-composer-guard
parent_pr: 31
title: skip composer injection in child session (subagent)
status: open
created: 2026-07-26
---

# Handoff — PR 33: skip composer injection in child session

## Контекст

Userscript `opencode-voice-dictation` добавляет кнопку 🎤 в composer OpenCode web UI. В **child session** (subagent, созданный через `task` tool) composer заменяется на disabled-блок "Prompt is disabled / Back to parent", но `session-prompt-dock` (внешний wrapper) остаётся в DOM (`showComposer()` = `!blocked() || !!parentID()` → всегда truthy в child). `findComposer()` в `src/ui.ts` использовал этот wrapper как валидный composer-target — кнопка 🎤 рендерилась над disabled-блоком, а клик падал с toast "Could not find input field" (нет `prompt-input` внутри dock'а, `insertIntoContenteditable()` возвращает `false`).

Это тот же класс бага, что и PR #31 (question-dock duplicate button) — `session-prompt-dock` используется как composer-target в ситуации, когда реальный composer внутри не отрендерен. PR #31 пофиксил только question-dock case (guard: skip dock если внутри `session-question-dock`), child-session case остался latent. Корневая причина та же: wrapper валиден как fallback-target в _нормальном_ состоянии, но вреден когда внутри нет реального composer.

Issue: #32. Предшественник: PR #31 (`docs/handoff/pr-31-question-dock-duplicate-button.md`).

## Что сделано

Три кодовых коммита на ветке `fix/ui/child-session-composer-guard`:

- **`fix(ui): skip composer injection in child session`** — `src/ui.ts` `findComposer()`: добавлен guard — `session-prompt-dock` skip'ается в цикле `COMPOSER_SELECTORS`, если внутри него НЕТ `[data-component="prompt-input"]` или `[data-component="prompt-input-v2"]`. В child session внутри dock'а только disabled-блок "Prompt is disabled / Back to parent" — guard срабатывает, цикл `continue` переходит к legacy-селекторам (`session-new-composer` / `session-composer`, удалены в v1.18.x), `findComposer()` возвращает `null`. Дополнительно `injectIntoComposer()`: ранний return если в документе нет `[data-component="prompt-input"], [data-component="prompt-input-v2"]` — defence-in-depth, страховка от future-случаев отсутствия реального composer (не только child session).
- **`chore: bump version to 1.0.3`** — `package.json` и `vite.config.ts` синхронно 1.0.2 → 1.0.3. Разблокировать автообновление userscript-менеджеров (ловушка PR #29 → #30: рассинхрон `@version` ломает `updateURL`).
- **`test(ui): cover dock without prompt-input case`** — новый `tests/ui.test.ts` (5 кейсов): dock с `prompt-input-v2` → кнопка есть; dock с `prompt-input` → кнопка есть; dock без composer (child session disabled-блок) → кнопки нет; пустой dock → кнопки нет; question-dock открыт → composer-кнопки нет (PR #31 regression guard). Тестирует через публичный `setupUI` + side-effect (`.ocvd-btn` в DOM), `findComposer` не экспортируется.

Четвёртый коммит — docs (этот handoff + ADR 0004).

## Почему

- **`session-prompt-dock` — общий wrapper для трёх состояний.** В `anomalyco/opencode` dev (`packages/app/src/pages/session/composer/session-composer-region.tsx`) `session-prompt-dock` div рендерится всегда когда `showComposer()` truthy. Внутри условно: `<Show when={questionRequest}>` → `SessionQuestionDock`, `<Show when={child()}>` → disabled-блок "Prompt is disabled / Back to parent", `<Show when={promptReady()}>` → `PromptInput`/`PromptInputV2Composer`. В child session (`session.parentID` заполнен) `child()=true` → disabled-блок, composer НЕ монтируется, но `session-prompt-dock` остаётся.
- **`findComposer()` выбирал wrapper.** `COMPOSER_SELECTORS` = [`prompt-input-v2`, `session-prompt-dock`, `session-new-composer`, `session-composer`] (ADR 0001). В child session `prompt-input-v2` отсутствует (первый промах), `session-prompt-dock` присутствует (второй успех). Guard PR #31 (skip если внутри `session-question-dock`) не срабатывал — внутри dock'а disabled-блок, не question-dock. → `findComposer` возвращал dock как composer-target.
- **Клик падал с toast.** `injectIntoElement` делал dock `position: relative` и append'ил контейнер с кнопкой (`position: absolute; top: 8px; right: 8px`) в правый-верхний угол wrapper'а — над disabled-блоком. При клике → `toggleDictation("composer")` → `insertIntoContenteditable()` → `document.querySelector('[data-component="prompt-input"]')` = `null` → toast "Could not find input field". Кнопка бесполезна, но видна.
- **Defence-in-depth.** Guard в `findComposer` (не возвращать dock без composer внутри) + guard в `injectIntoComposer` (не вставлять если в документе нет `prompt-input`/`prompt-input-v2`). Оба слоя независимы — любой один достаточно для фикса, второй страховка на edge-cases (race conditions, partial DOM state, future-варианты отсутствия composer). Аналог паттерна PR #31.

## Pending

- Live-verify на opencode.slaid098.dev после merge: открыть main session → вызвать subagent через `task` → дождаться перехода в child session → проверить, что над disabled-блоком "Prompt is disabled / Back to parent" НЕТ кнопки 🎤. Вернуться в parent session → проверить, что в композере кнопка 🎤 появилась (регресса нет).
- Подтвердить, что userscript-менеджеры подтянули автообновление: сравнить `@version` в `about:` для установленного скрипта с `1.0.3`. Если менеджер не видит обновление — проверить, что `updateURL` в `vite.config.ts` указывает на свежий `.meta.js` в ветке `dist/` (или `main` после merge).
- Проверить regression PR #31: открыть сессию → дождаться вопроса от агента → кликнуть «Свой ответ» → проверить, что composer-кнопки сверху блока вопросов НЕТ (только question-кнопка в textarea).
- После `oldInterfaceSunset` (2026-09-14) legacy-селекторы `session-composer` / `session-new-composer` в `COMPOSER_SELECTORS` и `PAGE_DETECT_SELECTORS` станут мёртвым кодом — удалить отдельным PR (общая pending-задача с PR #29/#30/#31).

## Watch out

- **`session-prompt-dock` остаётся в `COMPOSER_SELECTORS` как fallback.** НЕ удалять — когда question-dock НЕ открыт и session НЕ child, `session-prompt-dock` — валидный composer-target (пока `prompt-input-v2` lazy-mount'ится, ADR 0001). Удаление селектора сломало бы раннее появление кнопки на свежих сессиях. Guard пропускает dock только когда внутри нет реального composer.
- **Два guard'а независимы — не объединять.** Guard в `findComposer` (skip dock без composer) и guard в `injectIntoComposer` (skip insert без composer в документе) защищают разные слои: первый предотвращает выбор неверного target, второй — неверную вставку даже если target выбран (edge-case: `prompt-input-v2` в transition state). Удаление любого оставляет race-condition window.
- **Guard в `injectIntoComposer` может задержать появление composer-кнопки на 1 кадр при переходе в parent session.** Если child session закрывается (disabled-блок ушёл, но `prompt-input-v2` ещё не смонтировался), `injectIntoComposer` вернёт `null` от `findComposer()`, следующий retry-цикл MutationObserver поймает появление composer. На практике незаметно (~16ms).
- **Нет cleanup застрявших кнопок у текущих пользователей.** Если баг уже проявился (кнопка вставлена в dock в child session), после автообновления до 1.0.3 новые вставки не происходят, но старые остаются до hard-refresh. Cosmetic, не blocking. Аналогично PR #31.
- **`findComposer` не экспортируется.** Тест `tests/ui.test.ts` тестирует через публичный `setupUI` + side-effect (`.ocvd-btn` в DOM), не через прямой вызов `findComposer`. Это интеграционный тест, но покрывает end-to-end сценарий бага.

## Изменения

### `src/ui.ts`

`findComposer()` — добавлен skip-блок для `session-prompt-dock` без реального composer внутри:
```ts
// session-prompt-dock валиден как composer-target ТОЛЬКО если внутри есть реальный composer;
// child session (subagent) рендерит disabled-блок "Prompt is disabled / Back to parent" вместо composer
if (
  el.getAttribute("data-component") === "session-prompt-dock" &&
  !el.querySelector('[data-component="prompt-input"], [data-component="prompt-input-v2"]')
) {
  continue;
}
```

`injectIntoComposer()` — добавлен ранний return при отсутствии реального composer в документе:
```ts
// Defence-in-depth: не вставлять, если в документе нет реального composer (child session / disabled-блок)
if (
  !document.querySelector('[data-component="prompt-input"], [data-component="prompt-input-v2"]')
) {
  return;
}
```

### `package.json`
- `"version": "1.0.2"` → `"version": "1.0.3"`.

### `vite.config.ts`
- `userscript.version: "1.0.2"` → `"1.0.3"`.

### `tests/ui.test.ts` (новый)
- 5 кейсов: dock с composer → кнопка есть; dock без composer (child session) → кнопки нет; пустой dock → кнопки нет; question-dock → composer-кнопки нет.

### Файлы вне спеки
- `src/audio.ts`, `src/transcribe.ts`, `src/config.ts`, `src/keyboard.ts`, `src/types.ts`, `src/insert.ts`, `src/index.ts` — без изменений.

## Коммиты

1. `fix(ui): skip composer injection in child session` — `src/ui.ts` (findComposer + injectIntoComposer)
2. `chore: bump version to 1.0.3` — `package.json` + `vite.config.ts`
3. `test(ui): cover dock without prompt-input case` — `tests/ui.test.ts`
4. `docs(handoff): add child-session composer guard handoff` — этот handoff + ADR 0004
5. `docs(handoff): set PR number` — после получения PR номера

## ADR

См. `docs/decisions/0004-pr-33-child-session-composer-guard.md`.

## Источники

- Предыдущий handoff: `docs/handoff/pr-31-question-dock-duplicate-button.md` (родительский PR, тот же класс бага)
- Предыдущий ADR: `docs/decisions/0003-pr-31-question-dock-duplicate-button.md` (defence-in-depth паттерн)
- Память: `technical/opencode-web-ui-child-session-composer-disabled.md` (child session рендерит disabled-блок, `session-composer-region.tsx` `<Show when={controller.child()}>`)
- Память: `technical/opencode-web-ui-composer-selectors-1.18.4.md` (`session-prompt-dock` как wrapper, lazy-mount)
- Issue: #32