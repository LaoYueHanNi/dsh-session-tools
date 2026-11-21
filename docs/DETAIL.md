No more copy-pasting between Sessions: say what needs to be passed on and the model relays it; ask for a result, and the other side sends the answer back when it is done.

## Ways to use it

- **Pass a word, hand off a chore**: just say "have the alpha Session regenerate the docs". The model finds that Session first, then composes your intent into a message and sends it over.
- **Ask for a reply**: add "report back when you're done". The plugin hands the target your return address, and it sends the result back on its own when finished; once delivered your part is over — no waiting, and nothing is peeked at behind your back.
- **See what a Session said**: only when you explicitly ask "show me what that Session has been talking about" does the model read it. It reads what that Session still remembers; anything compacted away earlier does not come back.
- **Move separate work into a new Session**: say "open a new Session in the alpha directory for this", and the new Session is born carrying that task. Directory, title, Agent preset, and model can all be named in passing; when the model or the reasoning effort is uncertain, it checks the available catalog before creating anything, and a preset can be named by what you call it ("the coding preset") — matched against the preset roster's display names, with candidates listed when the name is ambiguous. Without a named effort, the one you last selected manually for that model is reused; if you never did, the model's own recommended default applies. For a blank Session use the sidebar's "New Session" — a Session with no content never shows up in the sidebar.
- **Hand off right from the composer**: type `/` and pick "Session message", choose a Session, and it lands in the composer as a chip; what you type after it is an **instruction for the model** (say, "sync the API change over"), which the model then composes into the real message. The chip only names the target — your words are never forwarded verbatim.

## How messages travel

Delivery is **one-way**: the message enters the other Session like an ordinary user message, waking it or joining in, and your side's job is done.

- When you need the result, say so. In Web chat, incoming handoffs and replies show the sending Session and a short preview. Select the card to read the full message. Steered messages use the Host’s standard display.
- When the other side is busy, just say whether it should "wait until you're done" or "cut in right now".
- When a name is ambiguous, the model lists the candidates and asks you to confirm instead of guessing.

## Some boundaries

- You cannot message yourself, nor a delegated Session running a subtask for you in the background — that is what session delegation is for.
- An archived Session must be restored in the client before it can receive messages, but it can still be read.
- A directory you name must have appeared in this machine's sidebar; for a path that never has, give the absolute path directly.
- You never need to remember tool names or parameters — just speak the way the examples above do.

A receipt confirms admission, not task completion; `persisted: true` additionally confirms a durability checkpoint, and anything else may not be on disk yet. If admission is unknown, retain the returned request ID and Session ID when retrying the same handoff.
