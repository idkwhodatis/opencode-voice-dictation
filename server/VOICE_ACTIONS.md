# Stop and review, or transcribe and send

The server-injected edition offers two explicit actions while recording. They are local to the current recording, not a global sending preference. **There is no additional voice-send button: OpenCode's original Send arrow is reused in place.**

| Control | Result |
| --- | --- |
| **Square — Stop and review** | Stops recording and inserts the transcript at the saved cursor position in OpenCode's normal editable composer. You can inspect, modify, delete, or manually send it. It never sends automatically. |
| **Original Send arrow — Transcribe and send** | While recording, stops recording and transcribes instead of immediately sending an unfinished draft. Inserts the transcript at the saved cursor position, then uses OpenCode's native sending behavior once the draft is ready. |
| **Cancel** | Discards an ongoing recording or cancels pending transcription. If text was already inserted while waiting for Send, it remains as a draft and is not sent. |

Ctrl+Space and the recording-duration limit always use **review**. Question-answer textareas only offer review; direct send is for the normal composer.

## Reusing the native Send button

The same button element, icon, layout, and original app listeners are retained. Only its voice-specific label and interaction are temporarily changed. During recording the verified Send arrow is made clickable even with an empty text draft: its action is to finish dictation, not to submit the empty draft. The temporary enabled override is removed before transcript insertion; actual message submission still waits for OpenCode's own enabled Send state. App changes to button state and labels are tracked rather than blindly restoring an old snapshot.

While microphone permission or transcription is pending, native Send clicks and form submissions are intercepted so an existing draft cannot be sent prematurely or twice. After insertion, only the validated internal Send click is allowed through. Plain Enter in the composer during recording follows the same transcribe-and-send path; Shift+Enter and IME composition are not intercepted. Idle typing and sending work normally.

**An agent's Stop button and shell/terminal actions are never repurposed.** If the native action is not a verified Send arrow, use Stop and review. Cancel, errors, session changes, and page exit release the override. A replaced native Send element is handled without cloning it or discarding its listeners.

## Cursor position and selected text

Place the cursor where the transcript should go, then start recording. You can move the cursor or select plain text while recording; the latest selection deliberately made inside the editor is remembered even when tapping the voice controls takes focus away. Pressing Stop or Transcribe and send **freezes that position for the pending transcription**. Moving the cursor afterward does not redirect the pending text.

For example, `Please fix |before committing.` plus the transcription `the login bug` becomes `Please fix the login bug before committing.` Both voice actions use the same insertion behavior. A plain-text selection is replaced, like typing. Spacing is added between adjoining word characters where needed, not between Chinese characters or before punctuation. The caret is left after the inserted text. If you have never placed a cursor in the editor, insertion defaults to appending at the end.

The rich-text editor is not rewritten wholesale. Mentions, attachments and unrelated formatting are preserved; a selection touching a protected mention/attachment is **not** replaced. If the draft changes while transcription is pending, or a saved selection is unsafe/stale, the transcript is appended at the end **for manual review**, with a notice, and direct send is suppressed. Entire editor/session changes still cancel the operation. Identical DOM rerenders can recreate text nodes without moving a frozen insertion point.

Text is inserted through native editing/input events so OpenCode sees the change. The service never bypasses the composer by calling the OpenCode session API. **Direct send submits the entire composer draft**, including any text and attachments already there.

If the native button is disabled, absent, hidden, or showing Stop/shell instead of Send after transcription, the transcript is retained for manual review. The browser waits at most 1.5 seconds for a verified Send button to enable; it does not queue a send behind a running agent. Changes to the draft during transcription or while awaiting Send cancel automatic sending. Empty/error responses never submit an existing draft. Double taps do not trigger duplicate transcriptions or sends.

## Settings and upgrades

The injected settings page has no global auto-send checkbox. Model, language, prompt, and temperature continue to persist through SQLite and the REST API. For backward compatibility, the database and REST responses retain the legacy `autoSubmit` field; the injected client deliberately ignores it. Existing `autoSubmit: true` does not change Stop into a send action. The Tampermonkey edition is unchanged: it still appends at the end and has its own auto-submit preference.

Pull the repository changes, restart the Bun voice service, and reload the OpenCode page. No Caddy routing, API-key, or SQLite migration changes are required.

## 中文

录音时不再添加额外发送按钮，直接复用 **OpenCode 原本的发送箭头**：点击后先停止录音、转写、在光标处插入文字，再通过原生发送逻辑发送整份草稿。**方形停止按钮**仍然只转写，方便检查、修改、删除或手动发送。取消或完成后会恢复原按钮的状态；运行中 agent 的 Stop 按钮和 shell 操作不会被接管。快捷键 Ctrl+Space 和录音时长上限始终只保留草稿。

两种操作都会在**光标位置插入**：录音时可以移动光标或选择普通文字；按停止或发送时会固定位置，等待转写期间再移动光标不会改变这次插入位置。选中的普通文字会被替换。若从未在输入框放置光标，则默认追加到末尾。提及和附件不会因转写被删除；若转写期间修改了草稿，或保存的选区不安全/失效，结果会追加到末尾供检查，并取消自动发送。Tampermonkey 版仍保持原来的末尾追加行为。

## Русский

Во время записи используется **исходная стрелка Send в OpenCode**, без дополнительной кнопки отправки. Она останавливает запись, вставляет транскрипцию в позицию курсора и отправляет весь черновик через штатный обработчик. **Квадратная кнопка остановки** по-прежнему оставляет текст для проверки. После отмены или завершения исходное поведение восстанавливается; кнопка Stop работающего агента и shell-действия не перехватываются. Ctrl+Space и лимит длительности всегда оставляют черновик для проверки.

Оба действия вставляют текст **в позицию курсора**. Во время записи можно перемещать курсор или выделять обычный текст; нажатие Stop или Send фиксирует позицию до завершения транскрипции. Выделенный обычный текст заменяется. Если сохранённой позиции нет, текст добавляется в конец. Упоминания и вложения не удаляются: при небезопасном выделении или изменении черновика результат добавляется в конец для ручной проверки, без автоматической отправки. Tampermonkey-версия по-прежнему добавляет текст в конец.
