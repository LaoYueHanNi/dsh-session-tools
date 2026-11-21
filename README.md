# dsh-session-tools

[简体中文](./README.zh.md) | English

A dsh plugin that gives the model **six cross-Session tools** and gives you a **Session message** row in the `/` menu (会话消息 on a Chinese interface).

- `session_list` — find a Session this one may message, by title / id / working directory
- `session_models` — list the model routes a new Session can run (provider, model, display name, reasoning efforts, default), before naming one
- `session_presets` — list the Agent presets a new Session can run (id, display name, description, default mark), before naming one
- `session_send` — hand one message to that Session; one-way delivery, **sending ends your part**, `reply: true` asks it to send the result back
- `session_read` — read a Session's recent user / assistant messages, only when you explicitly ask to see them
- `session_create` — create a Session (directory / title / Agent preset / optional model route) and hand it a first message
- **Handoff cards** — successful sends and creations show a clickable receipt below the answer. In Web chat, incoming handoffs show the sending Session and a short preview. Select the card to read the full message.
- **Session message** (`/` menu, with icon) — pick a Session and a **Session chip** (same rendering as an `@` reference) is inserted into the composer. What you type next is an **instruction for the model**: the chip serializes to `[Target session: <sessionId>]` on submit (`[目标会话：<sessionId>]` on a Chinese interface), and the model composes the real message and calls `session_send`

There is deliberately **no verbatim-delivery command**: to send text unchanged, just say it in that Session yourself.

## Installation

```sh
dsh plugin --profile <name> add @laoyuehanni/dsh-session-tools
```

The package declares `dsh.bundle`, so it joins the profile's bundle stack automatically — no manual profile editing. Restart the profile (or reload the plugin) afterwards.

Verify it: ask the model *"list the Sessions I can message"* (`session_list`), then *"send … to …"* (`session_send`). Typing `/` yourself shows the **Session message** row.

## Tools

| Tool | What it does | When the model should reach for it |
|---|---|---|
| `session_list` | Lists visible Sessions: id, title, cwd, creation time, archived / delegated flags | To resolve a conversation the user names in prose before sending |
| `session_models` | Lists every route the Host can run in a new Session, with display names, reasoning efforts, and the default selection | Before `session_create` names a model or effort, or when the user asks what is available |
| `session_presets` | Lists every Agent preset the Host can run in a new Session, with display names, descriptions, and the default mark | Before `session_create` names a preset, or when the user refers to a preset informally |
| `session_send` | Delivers one message into another Session's inbox | To hand work to another conversation, or to answer one that handed work here |
| `session_read` | Projects recent `user` / `assistant` text rows of one Session | Only when the user asks what that Session said — never to follow up on a send |
| `session_create` | Registers the directory as a Workspace, creates the Session there, optionally titles it, optionally selects its model (validated against the live catalog), and delivers its required first message | To move separate work into its own conversation (another checkout, another plugin) |

Targets resolve by exact id, then exact title, then case-insensitive substring; an ambiguous title returns candidates instead of guessing. Sending to the calling Session, to a delegated subagent Session, or to an archived Session is refused with an explanation.

`session_create` takes its directory three ways: an absolute path, a path relative to the calling Session, or the name the user actually said — a Workspace title, a directory's last segment like `alpha`, or a Session title. Spoken names resolve against the Workspaces and Session directories this Host already knows; a name matching several is refused with candidates, and an unknown one lists what is known.

Its `message` is required. A Session that never received an event carries no sidebar row, so a creation with no first message would produce something the user cannot see or open; the tool refuses it instead. For an empty conversation, the sidebar button is the path.

An optional model route names the model the new Session runs: pass `provider` and `model` together (`session_models` lists the exact ids with reasoning efforts), optionally with `reasoningEffort`. The selection is recorded before the first message is delivered, and it never changes your default model. An omitted effort is completed from what the Host already knows: when the named model is the one you last selected manually in the GUI, that same effort is reused; otherwise the model's provider-recommended default applies.

An optional `agentPreset` names the Agent preset the new Session runs: the exact id, or the name you actually called it ("the coding preset"). A name resolves against the preset roster's display names (`session_presets` lists them) before anything is created; several matches return candidates, an unknown one returns the whole roster, and omitting it keeps the configured default. Naming a preset on a Host that composes no roster is refused instead of silently dropped.

## Delivery model

Delivery is **one-way and fire-and-forget**. A delivered message ends the sender's part whether or not the target answers, and the sender must not read or poll the target afterwards.

When the result matters, set `reply: true`. The plugin then appends a return address to the delivered body:

```
[来自会话「<sender title>」(<sender id>)]

<message>

[回报方式：完成后用 session_send 把结果发给「<sender title>」(<sender id>)。发完即结束，不要等待或轮询。]
```

The receiving model sends its answer back with `session_send`; it arrives in the originating conversation as an ordinary message from another Session. Neither side reads or polls the other.

Both live and cold Sessions use the Host's `prompt` admission with a stable request ID. `accepted` confirms admission. `persisted: true` also confirms that the Host acknowledged a durability checkpoint. After an `unknown` result, retry the same target and message with the returned `requestId`. Reuse the returned Session ID after an unconfirmed first delivery. If creation returns `setup_failed`, fix the reported setup issue before submitting the first message. The Host recovers recorded request IDs from its event history. Deduplication after a process crash depends on the request having reached durable storage. The ordinary user message includes the sender's identity in its text.

## The Session message flow

1. Type `/` and pick **Session message**.
2. Pick a Session from the list (searchable; each row shows the directory tail and relative activity time).
3. A Session chip is inserted **at the caret without overwriting** anything you already typed.
4. Type your instruction — e.g. *"sync the API change to it and have it regenerate the docs"*.
5. On submit the chip becomes `[Target session: <sessionId>]`; the model reads the marker, composes the actual message, and calls `session_send`.

The marker is deliberately **not** `@[label](dsh-session:…)`: that URI is what makes the built-in `session-reference` plugin inject a read-only snapshot of the target. The bracket marker is plain context, so no Session content is ever read behind your back.

## Requirements

- DeepSeek Harness `0.2.2-rc.5` (the versions this package type-checks against)
- Node `>= 22.19`
- A Web profile (the Client half targets `platform: web`)

The package has **no runtime dependencies**: every `@deepseek-ai/*` import is type-only, and the browser bundle resolves React and Cordis from the web shell's frozen module table.

## Configuration

None. All six tools and browser features load with the plugin.

## Implementation notes

- **Titles** come from Session projections (`sessionProjections`, with the optional `sessionProjectionCache` for cold rows) — no log folding, so listing stays cheap.
- **Archived / delegated** state comes from `workspaceRegistry.archivedSessionIds` and the Session header's `origin`.
- **Creating a Session** resolves `cwd` to an existing directory first (using filesystem `stat`). When the argument is not a directory, it is matched by name against `workspaceRegistry.list()` titles/paths and the listed Sessions' `cwd` values — separators, case, and padding punctuation are normalized, so a spoken name lands on the directory the sidebar shows. The directory is then registered as a Workspace (`workspaceRegistry.create`) and the Session is created from that `workspaceId`. A Session created with a bare `cwd` belongs to no Workspace and stays out of every grouped list. An omitted `cwd` inherits the calling Session's directory; a title is applied through `sessionTitle.rename` on a best-effort basis. The first message is mandatory and travels the same handoff path as `session_send`, but an unknown admission may leave the new Session without a sidebar row. An optional `provider`/`model`/`reasoningEffort` route is validated against `sessionController.modelCatalog()` before the Session exists (a miss costs nothing and lists the catalog), then recorded through `agent.model.select()` before the first message is delivered — it appends only that Session's `model/selection` event and never touches the Host-wide default model. An optional `agentPreset` resolves against the `agentPresets` roster the same way: the exact id wins, then a normalized name match (exact, then substring) against usable presets' display names, with candidates on ambiguity and the whole roster on a miss; a deployment without a roster refuses a named preset rather than dropping it silently.
- **Reading a Session** uses `sessionQuery.readSurface(id)` and projects only `text` blocks of `user/message` and `assistant/message` rows. Reasoning, images, files, tool calls, and tool results never enter the result; each message body is capped at 4000 characters.
- **The chip** is a `ReferenceInsert` with `appearance: 'session'`. Its serialization is owned by a trigger source this plugin registers (`codec.serialize`), which emits the bracket marker. When the editor refuses chips, the same marker is appended as plain text after the existing draft.

## Known limitations

- **A chip in the composer is text in the sent message.** Chips exist only in the editor; on submit they serialize to text. The native `@` reference behaves the same way. Rendering a chip inside the message bubble would require replacing the `conversation.chat.node` user renderer, which would also override image and status rendering — not worth it.
- **The picker's `detail` slot is left-aligned** in the shared `popupSelect` shell, so the directory and the activity time share one right-hand string instead of two aligned columns.
- **No relationship memory.** The plugin keeps no ledger of which Session messaged which, or why. Inbound provenance survives only as the `[来自会话「…」(id)]` envelope in that conversation's own history; after context compaction the model may no longer know that it created a given Session. Call `session_list` to re-derive it when needed.

## Development

```sh
pnpm install
pnpm run typecheck        # tsc --noEmit
pnpm run build:all        # tsc -> lib/, then tsdown -> lib/client.js
pnpm run check:decisions  # decision-record validation
pnpm test                 # Verify the built Host and Client entries in lib/
```

`lib/` is build output and never committed; `prepublishOnly` runs typecheck, decision-record validation, build, and tests before every publish.

Non-trivial changes carry a decision record under [`docs/decisions/`](./docs/decisions) — see its [README](./docs/decisions/README.md) for the format and lifecycle rules, and [`docs/DETAIL.md`](./docs/DETAIL.md) for the plugin detail page text. Per-version notes live in [`docs/releases/`](./docs/releases).

## License

MIT
