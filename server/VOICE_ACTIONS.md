# Stop and review, or transcribe and send

The server-injected edition offers two explicit actions while recording. They are local to the current recording, not a global sending preference.

| Control | Result |
| --- | --- |
| **Square — Stop and review** | Stops recording and inserts the transcript into OpenCode's normal editable composer. You can inspect, modify, delete, or manually send it. It never sends automatically. |
| **Up arrow — Transcribe and send** | Stops recording, inserts the transcript, then activates OpenCode's verified native Send button once it becomes ready. |
| **Cancel** | Discards an ongoing recording or cancels pending transcription. If text was already inserted while waiting for Send, it remains as a draft and is not sent. |

Ctrl+Space and the recording-duration limit always use **review**. Question-answer textareas only offer review; direct send is for the normal composer.

Text is inserted using the existing rich-text adapter and input event. The service never force-enables OpenCode's button and never bypasses the composer by calling the OpenCode session API. Existing text, mentions, and attachments remain intact. **Direct send submits the entire composer draft**, including any text and attachments already there.

If the native button is disabled, absent, hidden, or showing Stop/shell instead of Send, the transcript is retained for manual review. The browser waits at most 1.5 seconds for a verified Send button to enable; it does not queue a send behind a running agent. Changes to the draft during transcription or while awaiting Send cancel automatic sending. Session/input changes cancel the operation; empty/error responses never submit an existing draft. Double taps do not trigger duplicate transcriptions or sends.

## Settings and upgrades

The injected settings page no longer has a global auto-send checkbox. Model, language, prompt, and temperature continue to persist through SQLite and the REST API. For backward compatibility, the database and REST responses retain the legacy `autoSubmit` field; the injected client deliberately ignores it. Existing `autoSubmit: true` does not change Stop into a send action. The Tampermonkey edition is unchanged and still has its own auto-submit preference.

Pull the repository changes, restart the Bun voice service, and reload the OpenCode page. No Caddy routing, API-key, or SQLite migration changes are required.

## 中文

录音时，**方形停止按钮**只转写并填入 OpenCode 的原生输入框，方便检查、修改、删除或手动发送。**向上箭头按钮**会转写并通过 OpenCode 的原生发送按钮发送整份草稿，包括已有文字和附件。快捷键和录音时长上限始终只保留草稿；取消、转写失败、空白结果、切换会话或修改待发送草稿都不会自动发送。

## Русский

Во время записи **квадратная кнопка остановки** вставляет транскрипцию как редактируемый черновик. **Стрелка вверх** вставляет текст и отправляет весь черновик через штатную кнопку Send, включая уже имеющийся текст и вложения. Горячая клавиша и лимит длительности всегда оставляют черновик для проверки. При отмене, ошибке, пустом ответе, смене сессии или изменении черновика автоматическая отправка не выполняется.
