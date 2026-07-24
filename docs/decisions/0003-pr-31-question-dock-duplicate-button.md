# ADR 0003: Prevent duplicate mic button in question-dock (defence-in-depth)

- **Date**: 2026-07-24
- **PR**: #31
- **Parent PR**: #30
- **Issue**: #28

## Статус

Accepted.

## Контекст

OpenCode web v1.18.3 (`sst/opencode` tag `v1.18.3`, `packages/app/src/pages/session/composer/session-composer-region.tsx:26`) использует `<div data-component="session-prompt-dock">` как общий wrapper-контейнер для двух условно-рендеримых дочерних блоков:

1. `<Show when={controller.state.questionRequest()} keyed>` → `<SessionQuestionDock>` — уточняющий вопрос от агента с опциями (включая textarea «Свой ответ» через `[data-slot="question-custom-input"]`).
2. `<Show when={controller.showComposer()}>` → `PromptInput` / `PromptInputV2Composer` — основной композер ввода.

`controller.showComposer()` (стр.62) = `!state.blocked() || !!parentID()`. Когда `questionRequest` truthy, `state.blocked() === true` и `parentID()` пуст → composer скрывается, но `session-prompt-dock` остаётся в DOM (он рендерится безусловно, стр.26).

`findComposer()` в `src/ui.ts` перебирает `COMPOSER_SELECTORS` (`prompt-input-v2` → `session-prompt-dock` → `session-new-composer` → `session-composer`, ADR 0001). Когда `prompt-input-v2` скрыт (composer не смонтирован), `querySelector` возвращает `null` для первого селектора, и `findComposer` проваливается на второй — `session-prompt-dock`, который валиден. `injectIntoElement` делает wrapper `position: relative` и append'ит контейнер с кнопкой 🎤 (`position: absolute; top: 8px; right: 8px`) в правый-верхний угол wrapper'а — то есть в верх блока вопросов, над `SessionQuestionDock`.

Одновременно `injectIntoQuestionPrompts` (вызывается в том же MutationObserver-цикле) находит `[data-slot="question-custom-input"]` и вставляет вторую кнопку 🎤 в `question-option-main` span (родитель textarea). Результат: 2 кнопки на экране.

После закрытия question-prompt (`questionRequest` → falsy, `commitCustom()`/`pick()`/`selectOption()`) `SessionQuestionDock` размонтируется, но кнопка в `session-prompt-dock` не удаляется автоматически: `injectIntoElement` имеет guard `if (existing) return null` (предотвращает дубликаты при повторном inject), но не имеет cleanup'а для размонтирования родителя. Кнопка остаётся видимой «в воздухе».

Дополнительные ограничения:
- `session-prompt-dock` нельзя удалить из `COMPOSER_SELECTORS` — когда question-dock НЕ открыт, это валидный fallback-target (пока `prompt-input-v2` ещё lazy-mount'ится, ADR 0001).
- `injectIntoQuestionPrompts` должен продолжать работать независимо от `injectIntoComposer` — они могут вызываться в одном MutationObserver-цикле.
- `match: ["*://*/*"]` + `run-at: document-idle` — userscript работает на всех сайтах, gate (`PAGE_DETECT_SELECTORS`, ADR 0002) отсеивает не-OpenCode.

## Решение

**Defence-in-depth: два независимых guard'а + бамп версии.**

**1. Guard в `findComposer()` (`src/ui.ts`).** Skip `session-prompt-dock` в цикле `COMPOSER_SELECTORS`, если внутри есть `[data-component="session-question-dock"]`:

```ts
function findComposer(): HTMLElement | null {
  for (const selector of COMPOSER_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
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

Wrapper остаётся в массиве (нужен когда question-dock НЕ открыт), но не возвращается как composer-target во время активного вопроса. Цикл `continue` пропускает его и переходит к следующим fallback-селекторам.

**2. Guard в `injectIntoComposer()` (`src/ui.ts`).** Ранний return, если в DOM есть `[data-slot="question-custom-input"]`:

```ts
function injectIntoComposer(onToggle: (target: InsertTarget) => void, onCancel: () => void): void {
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

Защищает edge-case: `prompt-input-v2` может быть в DOM одновременно с `question-custom-input` во время transition (SPA SolidJS не гарантирует синхронное размонтирование). Guard в `findComposer` пропустит `session-prompt-dock` (внутри есть `session-question-dock`), но НЕ пропустит `prompt-input-v2` — а `prompt-input-v2` тоже может быть в transition state. Второй guard ловит это на уровне insertion.

**3. Бамп `@version` 1.0.1 → 1.0.2** в `package.json` и `vite.config.ts` (синхронно, ADR 0002 gotcha). Разблокировать автообновление userscript-менеджеров — пользователи на 1.0.1 не получат фикс без явного re-install.

Два guard'а независимы: любой один достаточно для типичного сценария, второй — страховка на race conditions и partial DOM state. Удаление любого сужает coverage, но не ломает основной фикс.

## Альтернативы

### 1. Убрать `session-prompt-dock` из `COMPOSER_SELECTORS`
- **Плюс**: минимальная правка — одна строка в массиве.
- **Минус**: `prompt-input-v2` lazy-mount'ится асинхронно (ADR 0001, `session-composer-region-controller.ts:136` `promptReady()`). Между появлением `session-prompt-dock` и появлением `prompt-input-v2` есть окно (до нескольких сотен ms на медленной сети), когда `findComposer()` вернёт `null` → кнопка 🎤 не появится до готовности `prompt-input-v2`. На v1.18.x это регрессия раннего появления кнопки (PR #29 explicitly добавил `session-prompt-dock` как fallback именно для этого). Текущее решение сохраняет fallback, но отключает его только когда он вреден (question-dock открыт).

### 2. CSS-only через `:has()` — скрыть застрявшую кнопку стилем
- **Плюс**: ноль правок в JS, чистый CSS.
- **Минус**: `:has()` работает внутри одного поддерева. Кнопка в `session-prompt-dock` и `session-question-dock` — оба внутри `session-prompt-dock`, так что `session-prompt-dock:has([data-component="session-question-dock"]) .ocvd-container { display: none }` технически возможно. Но это маскирует симптом, не лечит root cause: контейнер остаётся в DOM, `injectIntoElement` guard `if (existing) return null` всё равно предотвратит правильную вставку после закрытия question (контейнер «существует», просто скрыт). После закрытия question кнопка НЕ появится в композере — UX regression хуже исходного бага. CSS-only не подходит для lifecycle-управления.

### 3. MutationObserver cleanup застрявших кнопок
- **Плюс**: лечит и текущий баг, и будущие edge-cases (любая застрявшая кнопка автоматически удаляется).
- **Минус**: сложнее. Требует observer на `session-prompt-dock` (или `document.body`), отслеживания удаления `session-question-dock`, проверки наличия `.ocvd-container` в `session-prompt-dock`, аккуратного remove. Не лечит root cause — кнопка всё равно вставляется в неверный target, просто быстрее убирается. Defence-in-depth через guards в `findComposer` + `injectIntoComposer` предотвращает вставку, что проще и надёжнее cleanup'а. Cleanup — кандидат на отдельный PR если обнаружатся другие сценарии застревания.

## Последствия

- `findComposer()` больше не возвращает `session-prompt-dock` как composer-target когда внутри `session-question-dock` — цикл `continue` пропускает его и переходит к `session-new-composer` / `session-composer` (legacy fallback, ADR 0001). На v1.18.x с открытым question-dock `findComposer` вернёт `null` — `injectIntoComposer` ничего не вставит, `injectIntoQuestionPrompts` единственный источник кнопки 🎤.
- `injectIntoComposer()` имеет ранний return при открытом `question-custom-input` — даже если `findComposer` найдёт валидный composer (edge-case transition state), вставка откладывается до закрытия question. На следующем MutationObserver-цикле (composer видим, textarea ушёл) вставка проходит нормально.
- `@version` 1.0.2 в `.meta.js` разблокирует автообновление userscript-менеджеров — пользователи получают исправление PR #31 одним обновлением.
- Два guard'а независимы: удаление любого оставляет race-condition window, но не ломает основной фикс. Не объединять в одну проверку — они защищают разные слои (target selection vs insertion).
- `session-prompt-dock` остаётся в `COMPOSER_SELECTORS` как fallback для нормального состояния (question-dock НЕ открыт) — не удалять без замены.
- Застрявшие кнопки у текущих пользователей (на 1.0.1) не удаляются автоматически — после автообновления до 1.0.2 новые вставки не происходят, но старые остаются до hard-refresh. Cosmetic, не blocking.

## Источники

- `src/ui.ts` (текущий): `findComposer()`, `injectIntoComposer()`, `COMPOSER_SELECTORS`, `injectIntoElement`
- `sst/opencode` tag `v1.18.3`, `packages/app/src/pages/session/composer/session-composer-region.tsx` (`session-prompt-dock` wrapper, `Show when={controller.state.questionRequest()}`)
- `sst/opencode` tag `v1.18.3`, `packages/app/src/pages/session/composer/session-question-dock.tsx` (`question-custom-input` lifecycle, `store.editing`)
- Предыдущий ADR: `docs/decisions/0001-pr-29-v1-18-composer-selectors-fallback-order.md` (`COMPOSER_SELECTORS` порядок, `session-prompt-dock` как fallback)
- Предыдущий ADR: `docs/decisions/0002-pr-30-broaden-page-detection-gate.md` (vite-plugin-monkey `@version` gotcha, gate broaden)
- Память: `technical/opencode-web-ui-composer-selectors-1.18.4.md` (`session-prompt-dock` = общий wrapper, lazy-mount)
- Память: `technical/opencode-question-custom-input-lifecycle-v1-18-3.md` (`question-custom-input` условный рендер, `session-prompt-dock` → `SessionQuestionDock`)