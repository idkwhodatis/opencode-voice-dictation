# ADR 0004: Composer-target guard checks for real input inside dock (child session)

- **Date**: 2026-07-26
- **PR**: 33
- **Parent PR**: #31
- **Issue**: #32

## Статус

Accepted.

## Контекст

OpenCode web (`anomalyco/opencode` dev, `packages/app/src/pages/session/composer/session-composer-region.tsx`) использует `<div data-component="session-prompt-dock">` как общий wrapper-контейнер для трёх условно-рендеримых дочерних блоков:

1. `<Show when={controller.state.questionRequest()} keyed>` → `<SessionQuestionDock>` — уточняющий вопрос от агента (PR #31 закрыл этот case).
2. `<Show when={controller.child()} fallback={...}>` → disabled-блок "Prompt is disabled / Back to parent" — child session (subagent, `session.parentID` заполнен).
3. `<Show when={controller.showComposer()}>` → `PromptInput` / `PromptInputV2Composer` — основной композер ввода.

`controller.showComposer()` = `!state.blocked() || !!parentID()`. В child session `parentID()` truthy → `showComposer()` всегда truthy → `session-prompt-dock` рендерится. Но `controller.child()` тоже truthy → disabled-блок (ветка 2), composer (ветка 3) НЕ монтируется. `prompt-input` / `prompt-input-v2` отсутствуют внутри dock'а.

`findComposer()` в `src/ui.ts` перебирает `COMPOSER_SELECTORS` (`prompt-input-v2` → `session-prompt-dock` → `session-new-composer` → `session-composer`, ADR 0001). В child session `prompt-input-v2` скрыт (первый промах), `session-prompt-dock` присутствует (второй успех). Guard PR #31 (skip dock если внутри `session-question-dock`) не срабатывал — внутри dock'а disabled-блок, не question-dock. → `findComposer` возвращал dock как composer-target.

`injectIntoElement` делал dock `position: relative` и append'ил контейнер с кнопкой 🎤 (`position: absolute; top: 8px; right: 8px`) в правый-верхний угол wrapper'а — над disabled-блоком. При клике → `toggleDictation("composer")` → `insertIntoContenteditable()` → `document.querySelector('[data-component="prompt-input"]')` = `null` → toast "Could not find input field". Кнопка бесполезна, но видна.

Дополнительные ограничения:
- `session-prompt-dock` нельзя удалить из `COMPOSER_SELECTORS` — когда question-dock НЕ открыт и session НЕ child, это валидный fallback-target (пока `prompt-input-v2` lazy-mount'ится, ADR 0001).
- `injectIntoQuestionPrompts` должен продолжать работать независимо от `injectIntoComposer`.
- `match: ["*://*/*"]` + `run-at: document-idle` — userscript работает на всех сайтах, gate (`PAGE_DETECT_SELECTORS`, ADR 0002) отсеивает не-OpenCode.

## Решение

**Defence-in-depth: guard на наличие реального composer внутри dock + guard на уровне документа + бамп версии.**

**1. Guard в `findComposer()` (`src/ui.ts`).** Skip `session-prompt-dock` в цикле `COMPOSER_SELECTORS`, если внутри НЕТ `[data-component="prompt-input"]` или `[data-component="prompt-input-v2"]`:

```ts
if (
  el.getAttribute("data-component") === "session-prompt-dock" &&
  !el.querySelector('[data-component="prompt-input"], [data-component="prompt-input-v2"]')
) {
  continue;
}
```

В child session внутри dock'а только disabled-блок — guard срабатывает, цикл `continue` переходит к legacy-селекторам (удалены в v1.18.x), `findComposer()` возвращает `null`. Wrapper остаётся в массиве (нужен в нормальном состоянии), но не возвращается как composer-target когда внутри нет реального composer.

**2. Guard в `injectIntoComposer()` (`src/ui.ts`).** Ранний return, если в документе НЕТ `[data-component="prompt-input"]` или `[data-component="prompt-input-v2"]`:

```ts
if (
  !document.querySelector('[data-component="prompt-input"], [data-component="prompt-input-v2"]')
) {
  return;
}
```

Defence-in-depth: защищает от любых future-случаев отсутствия реального composer (не только child session). Срабатывает на уровне документа, независим от `findComposer`.

**3. Бамп `@version` 1.0.2 → 1.0.3** в `package.json` и `vite.config.ts` (синхронно, ADR 0002 gotcha). Разблокировать автообновление userscript-менеджеров.

Два guard'а независимы: любой один достаточно для типичного сценария, второй — страховка на race conditions и partial DOM state. Удаление любого сужает coverage, но не ломает основной фикс.

## Альтернативы

### 1. Детектировать child session по disabled-блоку (текст "Prompt is disabled" / кнопка "Back to parent")
- **Плюс**: явная детекция именно child session.
- **Минус**: хрупко — зависит от локали (i18n ключи `session.child.promptDisabled` / `session.child.backToParent`), текст может меняться между версиями. Проверка отсутствия `prompt-input` внутри dock — структурная, не зависит от текста. Предпочтительнее.

### 2. Убрать `session-prompt-dock` из `COMPOSER_SELECTORS`
- **Плюс**: минимальная правка — одна строка.
- **Минус**: `prompt-input-v2` lazy-mount'ится асинхронно (ADR 0001). Между появлением `session-prompt-dock` и `prompt-input-v2` есть окно (до сотен ms), когда `findComposer()` вернёт `null` → кнопка 🎤 не появится до готовности `prompt-input-v2`. Регрессия раннего появления кнопки (PR #29 explicitly добавил `session-prompt-dock` как fallback). Текущее решение сохраняет fallback, но отключает только когда он вреден.

### 3. CSS-only через `:has()` — скрыть кнопку когда внутри dock нет composer
- **Плюс**: ноль правок в JS.
- **Минус**: маскирует симптом, не лечит root cause. Контейнер остаётся в DOM, `injectIntoElement` guard `if (existing) return null` предотвратит правильную вставку после возврата в parent session (контейнер «существует», просто скрыт). UX regression. CSS-only не подходит для lifecycle-управления (аналогично ADR 0003 альтернативе 2).

### 4. MutationObserver cleanup застрявших кнопок
- **Плюс**: лечит и текущий баг, и будущие edge-cases.
- **Минус**: сложнее, не лечит root cause — кнопка всё равно вставляется в неверный target, просто быстрее убирается. Defence-in-depth через guards предотвращает вставку, что проще и надёжнее. Cleanup — кандидат на отдельный PR если обнаружатся другие сценарии (аналогично ADR 0003).

## Последствия

- `findComposer()` больше не возвращает `session-prompt-dock` как composer-target когда внутри нет `prompt-input`/`prompt-input-v2` — цикл `continue` пропускает его и переходит к legacy-селекторам (удалены в v1.18.x). В child session `findComposer` вернёт `null` — `injectIntoComposer` ничего не вставит.
- `injectIntoComposer()` имеет ранний return при отсутствии реального composer в документе — даже если `findComposer` найдёт валидный target (edge-case), вставка откладывается до появления `prompt-input`/`prompt-input-v2`. На следующем MutationObserver-цикле вставка проходит нормально.
- `@version` 1.0.3 в `.meta.js` разблокирует автообновление userscript-менеджеров.
- Два guard'а независимы: удаление любого оставляет race-condition window, но не ломает основной фикс. Не объединять в одну проверку — они защищают разные слои (target selection vs insertion).
- `session-prompt-dock` остаётся в `COMPOSER_SELECTORS` как fallback для нормального состояния — не удалять без замены.
- Застрявшие кнопки у текущих пользователей (на 1.0.2) не удаляются автоматически — после автообновления до 1.0.3 новые вставки не происходят, но старые остаются до hard-refresh. Cosmetic, не blocking (аналогично PR #31).
- Guard устойчив к future-вариантам: любой сценарий где `session-prompt-dock` есть, а `prompt-input`/`prompt-input-v2` внутри нет — пропустит dock. Не привязан к конкретной структуре disabled-блока.

## Источники

- `src/ui.ts` (текущий): `findComposer()`, `injectIntoComposer()`, `COMPOSER_SELECTORS`, `injectIntoElement`
- `anomalyco/opencode` dev, `packages/app/src/pages/session/composer/session-composer-region.tsx` (`session-prompt-dock` wrapper, `<Show when={controller.child()}>` disabled-блок)
- `anomalyco/opencode` dev, `packages/app/src/pages/session/composer/session-composer-region-controller.ts` (`child()` = `!!parentID()`, `showComposer()` = `!blocked() || !!parentID()`)
- Предыдущий ADR: `docs/decisions/0001-pr-29-v1-18-composer-selectors-fallback-order.md` (`COMPOSER_SELECTORS` порядок, `session-prompt-dock` как fallback)
- Предыдущий ADR: `docs/decisions/0003-pr-31-question-dock-duplicate-button.md` (defence-in-depth паттерн, `session-question-dock` guard)
- Память: `technical/opencode-web-ui-child-session-composer-disabled.md` (child session рендерит disabled-блок, варианты фикса)
- Память: `technical/opencode-web-ui-composer-selectors-1.18.4.md` (`session-prompt-dock` = общий wrapper, lazy-mount)
- Issue: #32