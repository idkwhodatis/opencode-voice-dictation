---
pr_number: 31
branch: fix/ui/question-dock-duplicate-button
parent_pr: 30
title: prevent duplicate mic button in question-dock
status: open
created: 2026-07-24
---

# Handoff — PR #31: prevent duplicate mic button in question-dock

## Контекст

PR #30 (`fix/ui: broaden page gate + debug logging + version bump`) расширил gate детекции страницы и добавил логирование, но оставил latent-баг с дубликатом кнопки 🎤 в question-dock. OpenCode v1.18.3 использует `session-prompt-dock` (`packages/app/src/pages/session/composer/session-composer-region.tsx:26`) как общий wrapper и для question-dock, и для composer. Когда агент задаёт уточняющий вопрос (`questionRequest`), композер скрывается (`blocked=true`), но `session-prompt-dock` остаётся в DOM. `findComposer()` в `src/ui.ts` находил этот wrapper (он стоит вторым в `COMPOSER_SELECTORS` после `prompt-input-v2`) и вставлял кнопку 🎤 в верх блока — одновременно с тем, как `injectIntoQuestionPrompts` вставлял вторую кнопку в `question-option-main` span (textarea «Свой ответ»). Результат: 2 кнопки на экране, верхняя застревала и не исчезала после закрытия question-prompt.

Issue: #28 (родительский). PR #31 — продолжение без новой issue.

## Что сделано

Два коммита с правками кода на ветке `fix/ui/question-dock-duplicate-button`:

- **`fix(ui): skip session-prompt-dock as composer target when question-dock open`** — `src/ui.ts` `findComposer()`: добавлен guard — `session-prompt-dock` skip'ается в цикле `COMPOSER_SELECTORS`, если внутри него присутствует `[data-component="session-question-dock"]`. Wrapper остаётся в массиве как fallback (нужен когда question-dock НЕ открыт), но не используется как composer-target во время активного вопроса.
- **`fix(ui): guard composer injection when question textarea open + bump 1.0.2`** — `src/ui.ts` `injectIntoComposer()`: добавлен ранний return, если в DOM есть `[data-slot="question-custom-input"]` (textarea «Свой ответ» открыта). Бамп `@version` 1.0.1 → 1.0.2 в `package.json` и `vite.config.ts` (синхронно) — разблокировать автообновление userscript-менеджеров.

Третий коммит — docs (этот handoff + ADR 0003).

## Почему

- **`session-prompt-dock` — общий wrapper.** В `sst/opencode` v1.18.3 (`session-composer-region.tsx`) `session-prompt-dock` div рендерится сразу (стр.26), внутри `<Show when={controller.state.questionRequest()}>` — `SessionQuestionDock`, и отдельно `<Show when={controller.showComposer()}>` — `PromptInput`/`PromptInputV2Composer`. Когда `questionRequest` truthy, composer скрывается (`blocked=true`), но `session-prompt-dock` остаётся. `findComposer()` (вторая итерация цикла после неудачи с `prompt-input-v2`) находил wrapper и возвращал его как composer-target.
- **Кнопка вставлялась в верх блока.** `injectIntoElement` делает target `position: relative` и append'ит контейнер с кнопкой. На `session-prompt-dock` (широкий wrapper) кнопка с `position: absolute; top: 8px; right: 8px` садится в правый-верхний угол всего блока вопросов, над `SessionQuestionDock`. Одновременно `injectIntoQuestionPrompts` вставлял вторую кнопку в `question-option-main` span (узкий контейнер textarea).
- **Застревание после закрытия.** Когда question-prompt закрывается (`questionRequest` становится falsy), `SessionQuestionDock` размонтируется, textarea исчезает — но `session-prompt-dock` остаётся (теперь с composer внутри). Кнопка, вставленная в `session-prompt-dock` во время question, не размонтируется автоматически (нет MutationObserver-cleanup), и `injectIntoElement` имеет guard `if (existing) return null`, который предотвращает повторную вставку, но не удаляет старую. Кнопка оставалась видимой «в воздухе».

Defence-in-depth: guard в `findComposer()` (не возвращать wrapper с question-dock) + guard в `injectIntoComposer()` (не вставлять, если textarea открыта). Оба слоя независимы — любой один достаточно для фикса, второй — страховка на edge-cases (race conditions, partial DOM state).

## Pending

- Live-verify на opencode.slaid098.dev v1.18.3 после merge: открыть сессию → дождаться вопроса от агента → кликнуть «Свой ответ» → проверить, что в textarea ровно 1 кнопка 🎤 (в `question-option-main`), и что сверху блока вопросов НЕТ второй кнопки. Закрыть question (выбрать опцию или Escape) → проверить, что верхняя кнопка исчезла (точнее — не появилась заново при re-inject), и в композере появилась ровно 1 кнопка.
- Подтвердить, что userscript-менеджеры подтянули автообновление: сравнить `@version` в `about:` для установленного скрипта с `1.0.2`. Если менеджер не видит обновление — проверить, что `updateURL` в `vite.config.ts` указывает на свежий `.meta.js` в ветке `dist/` (или `main` после merge).
- После `oldInterfaceSunset` (2026-09-14) legacy-селекторы `session-composer` / `session-new-composer` в `COMPOSER_SELECTORS` и `PAGE_DETECT_SELECTORS` станут мёртвым кодом — удалить отдельным PR (общая pending-задача с PR #29/#30).

## Watch out

- **`session-prompt-dock` остаётся в `COMPOSER_SELECTORS` как fallback.** НЕ удалять его — когда question-dock НЕ открыт, `session-prompt-dock` — валидный composer-target (например, пока `prompt-input-v2` ещё lazy-mount'ится внутри dock'а). Удаление селектора сломало бы раннее появление кнопки на свежих сессиях.
- **Guard в `injectIntoComposer()` может задержать появление composer-кнопки на 1 кадр при закрытии question.** `injectIntoComposer` проверяет `question-custom-input` на момент вызова. Если question-prompt закрывается (textarea уже ушёл из DOM, но composer ещё не успел смонтироваться), `injectIntoComposer` вернёт `null` от `findComposer()` (composer ещё не готов), следующий retry-цикл MutationObserver поймает появление composer. На практике незаметно (1 кадр = ~16ms).
- **Два guard'а независимы — не объединять.** Guard в `findComposer` (skip wrapper) и guard в `injectIntoComposer` (skip insert) защищают разные слои: первый предотвращает выбор неверного target, второй — неверную вставку даже если target валиден (edge-case: `prompt-input-v2` может быть в DOM одновременно с `question-custom-input` во время transition). Удаление любого из них оставляет race-condition window.
- **Нет cleanup застрявших кнопок.** Если баг уже проявился (кнопка вставлена в `session-prompt-dock` во время question), `injectIntoElement` guard `if (existing) return null` не удаляет старую. После merge PR #31 новые вставки не происходят, но уже вставленные кнопки у пользователей останутся до hard-refresh. Можно добавить MutationObserver-cleanup в отдельном PR, но это усложнение без необходимости (после автообновления 1.0.2 проблема не воспроизводится).

## Изменения

### `src/ui.ts`

`findComposer()` — добавлен skip-блок для `session-prompt-dock` с `session-question-dock` внутри:
```ts
function findComposer(): HTMLElement | null {
  for (const selector of COMPOSER_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      // session-prompt-dock — общий wrapper для question-dock и composer;
      // если внутри question-dock, не использовать как composer-target
      if (
        el.getAttribute("data-component") === "session-prompt-dock" &&
        el.querySelector('[data-component="session-question-dock"]')
      ) {
        continue;
      }
      console.log(`[ocvd] Composer found via ${selector}`);
      return el;
    }
  }
  console.log("[ocvd] No composer found in DOM");
  return null;
}
```

`injectIntoComposer()` — добавлен ранний return при открытом question-textarea:
```ts
function injectIntoComposer(onToggle: (target: InsertTarget) => void, onCancel: () => void): void {
  // Не вставлять composer-кнопку, если открыт question-prompt с textarea «Свой ответ»
  if (document.querySelector('[data-slot="question-custom-input"]')) {
    return;
  }
  const composer = findComposer();
  if (composer) {
    injectIntoElement(composer, onToggle, onCancel, "composer");
    console.log("[ocvd] Mic button injected into composer");
  }
}
```

### `package.json`
- `"version": "1.0.1"` → `"version": "1.0.2"`.

### `vite.config.ts`
- `userscript.version: "1.0.1"` → `"1.0.2"`.

### Файлы вне спеки
- `src/audio.ts`, `src/transcribe.ts`, `src/config.ts`, `src/keyboard.ts`, `src/types.ts`, `src/insert.ts`, `src/index.ts` — без изменений.

## Коммиты

1. `fix(ui): skip session-prompt-dock as composer target when question-dock open` — `src/ui.ts` (findComposer)
2. `fix(ui): guard composer injection when question textarea open` — `src/ui.ts` (injectIntoComposer) + `package.json` + `vite.config.ts` (version bump)
3. `docs(handoff): add handoff + ADR for PR` — этот коммит

## ADR

См. `docs/decisions/0003-pr-31-question-dock-duplicate-button.md`.

## Источники

- Предыдущий handoff: `docs/handoff/pr-30-v1-18-runtime-gate-debug.md` (родительский PR, gate + логирование)
- Предыдущий ADR: `docs/decisions/0002-pr-30-broaden-page-detection-gate.md` (gate broaden, vite-plugin-monkey @version gotcha)
- Память: `technical/opencode-web-ui-composer-selectors-1.18.4.md` (`session-prompt-dock` как wrapper, lazy-mount композера)
- Память: `technical/opencode-question-custom-input-lifecycle-v1-18-3.md` (`session-prompt-dock` → `SessionQuestionDock` условный рендер, `question-custom-input` lifecycle)
- Live-верификация: opencode.slaid098.dev v1.18.3 (pending после merge)