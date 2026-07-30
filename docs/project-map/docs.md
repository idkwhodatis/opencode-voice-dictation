---
module: docs
purpose: Handoff-документы, ADR, project map
key_files:
  - docs/handoff/pr-<N>-<slug>.md — handoff на PR
  - docs/decisions/<NNNN>-pr-<N>-<slug>.md — архитектурные решения (ADR)
  - docs/project-map/ — карта структуры проекта
dependencies: []
last_updated: 2026-07-30
---

# docs/

## Structure
- `handoff/pr-<N>-<slug>.md` — handoff на PR (секции: Что сделано, Почему, Pending, Watch out)
- `decisions/<NNNN>-pr-<N>-<slug>.md` — архитектурные решения (секции: Статус, Контекст, Решение, Альтернативы)
- `project-map/` — карта структуры проекта (README + по файлу на модуль)

## Patterns
- Один handoff на PR, slug = тема PR.
- ADR нумеруются с 0001, имя `<NNNN>-pr-<N>-<slug>.md`.