ccd_session x5 mcp
{
  "name": "mcp__ccd_session__dismiss_task",
  "description": "Withdraw a proposal you made with start_session (initiation \"own_initiative\" or \"offer\") that the user has not started.\n\nCall this when it went stale: the work was done here after all (by you or the user), it turned out unnecessary, or you proposed a better-scoped replacement (propose the new one first, then dismiss the old task_id). A card the user answered has already left, \"Do it here\" included, so it needs no call.",
  "input_schema": {
    "type": "object",
    "properties": {
      "task_id": {
        "description": "The task_id the start_session proposal returned.",
        "type": "string"
      },
      "reason": {
        "description": "Optional one-line reason the suggestion is no longer needed, e.g. \"fixed in this session\" or \"superseded by task_ab12cd34\".",
        "type": "string"
      }
    },
    "required": [
      "task_id"
    ],
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
{
  "name": "mcp__ccd_session__hand_off_to_session",
  "description": "Move the task you are in the middle of into its own session (a fork of this conversation plus your remaining plan) so you can answer the user now. Use it when a new user message about something else arrives mid-task — not for small corrections or when the user said to keep the work here. In a worktree the fork gets a fresh worktree, normally cut from your branch tip: commit first (uncommitted edits stay here). Bold title line and one sentence right before the call; after it, stop that task here and answer the new message — no recap.",
  "input_schema": {
    "type": "object",
    "properties": {
      "title": {
        "description": "Under 60 chars; names the task being moved.",
        "type": "string"
      },
      "remaining_plan": {
        "description": "What is left to do: steps, files, what done looks like.",
        "type": "string"
      }
    },
    "required": [
      "title",
      "remaining_plan"
    ],
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
{
  "name": "mcp__ccd_session__mark_chapter",
  "description": "Mark the start of a new chapter in this session.\n\nCall this when the work shifts to a meaningfully different phase — e.g. after finishing exploration and starting implementation, after a fix lands and you move to verification, or when the user pivots to an unrelated request. The user sees a divider in the transcript and a floating table of contents for jumping between chapters.\n\nUse sparingly: a chapter should cover a coherent stretch of work, not every tool call. A typical session has 3–8 chapters. Do not mark a chapter for the very first message — the session start is implicit.\n\nThe title is a short noun phrase (\"Codebase exploration\", \"Auth bug fix\", \"Test verification\"), not a sentence.",
  "input_schema": {
    "type": "object",
    "properties": {
      "title": {
        "description": "Short noun-phrase title for the chapter (under 40 chars). Shown in the table of contents.",
        "type": "string"
      },
      "summary": {
        "description": "Optional one-line summary of what this chapter covers. Shown on hover in the table of contents.",
        "type": "string"
      }
    },
    "required": [
      "title"
    ],
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}
{
  "name": "mcp__ccd_session__read_widget_context",
  "description": "Read context from an embedded interactive widget. Widgets are rendered alongside chat from prior tool calls and can be interacted with by the user. Call this when you need to know the current state of a widget.",
  "input_schema": {
    "type": "object",
    "properties": {
      "tool_name": {
        "description": "The name of the widget tool to get context for",
        "type": "string"
      }
    },
    "required": [
      "tool_name"
    ],
    "$schema": "http://json-schema.org/draft-07/schema#"
  }
}

{
  "name": "mcp__ccd_session__start_session",
  "description": "Start a separate Claude Code session for a task while you stay with the user (when: see \"Starting other sessions\"). `initiation` says who wants it: \"user_asked\" starts it now and returns its id; \"offer\" is for a task the user named in their latest message (new work here, or \"suggest / split off / make a task or session for X\"): called with a title alone, it shows a \"New session\" / \"Do it here\" card and WAITS for their answer, so it must be the only call in that message (no update_plan, no other tool); the result then tells you to carry on here, or to send the brief with proposal_id so the session starts; \"own_initiative\" is for work you propose yourself that the user has not told you to do — something you noticed, or the follow-up your own answer or work turned up (when your reply calls work a follow-up or a separate PR, propose it here rather than only saying so, unless it acts on what this session just found and so stays here), never what \"Starting other sessions\" keeps here or gives to a subagent; the user sees a card and nothing runs until they start it, by clicking it or by telling you (then call this again with just proposal_id; for the cloud, see proposal_id).\n\"user_asked\" and \"own_initiative\" both need a `prompt` — the brief: the task, the files or area, what done looks like — and the call is refused without it; `background` does not stand in for it. Only an \"offer\" is a title alone.\ncontext: \"fork\" = this whole conversation + your `prompt`. \"fresh\" (default) = your `prompt` + `background` only, so `background` is required too, at least 80 characters.\nCheckout here (\"fresh\" only): use_worktree false = shares this checkout and can edit it (in a worktree session its branch and PR too: never for work that ends in a branch or PR of its own or belongs in another repository); true = its own worktree (the default when this session is in one).\nElsewhere (\"fresh\", user_asked only, when the user named the place): `cwd`, `target` \"ssh\" + `host`, `environment` or `preset`; list_start_targets lists the valid names.",
  "input_schema": {
    "type": "object",
    "properties": {
      "initiation": {
        "type": "string",
        "enum": [
          "user_asked",
          "own_initiative",
          "offer"
        ],
        "description": "\"user_asked\": the user asked in words for separate, parallel or background work, or told you to start this piece — it starts now (not for a piece \"Starting other sessions\" gives to a subagent). \"offer\": a task the user named in their latest message (new work for this session, or one they asked you to suggest, split off or make a session for) — the user is asked first and the call waits for their answer; send only title with it (the brief follows, with proposal_id, if they choose New session). \"own_initiative\": work you propose yourself that the user has not told you to do — something you noticed, or the follow-up your own answer or work turned up; it waits as a proposal card until the user starts it; never for a task the user's message tells you to do, nor for the one piece of work \"Starting other sessions\" keeps here, nor for what it gives to a subagent. Required unless proposal_id is set."
      },
      "proposal_id": {
        "description": "Start a proposal the user told you to start, exactly as proposed: its task_id and nothing else (wake_when_done may accompany a local one). To change it, or if you proposed it for the cloud, dismiss_task it and start a new session.",
        "type": "string"
      },
      "title": {
        "description": "Under 60 chars; names the task. Shown on the row or card. Required unless proposal_id is set.",
        "type": "string"
      },
      "prompt": {
        "description": "The brief: the task, the files or area, what done looks like. Required for \"user_asked\" and \"own_initiative\" — the call is refused without it, and `background` does not stand in for it; an \"offer\" leaves it out (the card shows the user's own message) and you send it with proposal_id once they choose New session. Here and in `background`, put file paths and code identifiers in backticks.",
        "type": "string"
      },
      "context": {
        "type": "string",
        "enum": [
          "fresh",
          "fork"
        ],
        "description": "\"fresh\" (default) or \"fork\" — see the tool description. A \"fork\" from a worktree session gets a fresh worktree, normally cut from your branch tip (commit first; uncommitted edits stay here); from a plain checkout it shares the folder."
      },
      "background": {
        "description": "Required with \"fresh\", besides `prompt`: at least 80 characters of overall goal, decisions and constraints so far, how this piece fits — for someone who has not seen this conversation. Ignored for \"fork\".",
        "type": "string"
      },
      "wake_when_done": {
        "description": "Once this session (and any sibling still working) ends its turn, or fails to start (unless it waits at a prompt the user answers there, its folder was never opened in Claude Desktop, or the user started, stopped or archived it), and you are idle, the app continues you, whether or not this is set. true also continues you if this session never gets its task some other way, such as a brief that is not sent; default false; not with own_initiative; ignored with target \"cloud\", which never continues you.",
        "type": "boolean"
      },
      "name": {
        "description": "Optional short handle for the session ([a-z0-9-], ≤24), e.g. \"cli-cleanup\". Linked sessions and plan steps refer to it by this name; derived from the title when omitted.",
        "type": "string"
      },
      "use_worktree": {
        "description": "\"fresh\" only (rejected with \"fork\"). false = shares this session's checkout and can edit it (in a worktree session: its worktree, branch and PR, so never for work that ends in a branch or PR of its own or belongs in another repository); not accepted from a session set up to move from the user's checkout into a worktree with EnterWorktree (before or after it moves), a fork of a session working in a worktree on an SSH host, or one whose worktree was given back. At another place named by `cwd`, `host` or `preset`, false = that folder as it is. true = its own git worktree. Omitted: the same folder when this session works in a plain folder and has never had a worktree (its own, a shared one, or one it will enter later); otherwise its own worktree. Omitted with `preset` or `host`, or with `cwd` from a session on an SSH host: the default set on that preset or SSH connection instead.",
        "type": "boolean"
      },
      "model": {
        "description": "\"fresh\" only, optional: a cheaper model id for mechanical or read-only pieces (e.g. a Sonnet or Haiku id). Same family or cheaper than yours; anything higher is ignored. Omit to inherit yours.",
        "type": "string"
      },
      "target": {
        "type": "string",
        "enum": [
          "local",
          "cloud",
          "ssh"
        ],
        "description": "\"fresh\" only. \"local\" (default) = where this session runs. \"cloud\" = run it as a cloud session (keeps going when this computer sleeps). Needs the repository on GitHub and a cloud environment — the app checks and tells the user if it cannot, and the task then stays as a card for them to start. model/effort/use_worktree/cwd/source_branch do not apply. Only when the user asks for the cloud. \"ssh\" = on the SSH connection named by host (or by a preset)."
      },
      "host": {
        "description": "With target \"ssh\": the name of one of the user's saved SSH connections (as list_start_targets reports it) — never a raw hostname, user or key. The app connects as the user configured it and may ask them to sign in.",
        "type": "string"
      },
      "cwd": {
        "description": "The folder the session works in, when it is not this project: an absolute (or ~/) path on the host it will run on — this computer, this session's host, or the SSH connection named by host (default there: the connection's folder). \"fresh\" only.",
        "type": "string"
      },
      "environment": {
        "description": "With target \"cloud\": the name or id of one of the user's cloud environments (list_start_targets lists them); omitted = the default one.",
        "type": "string"
      },
      "repository": {
        "description": "With target \"cloud\", only when the user named a repository other than this project's: \"owner/name\" on github.com, which the cloud session clones at its default branch. Take the exact owner/name from the user's words or a listing that shows it; if you are not sure of it, ask them. A bypass or auto permission mode may not carry over: the session then starts in the cloud's default mode. If the call is refused, do not run or propose the other repository's work in this project.",
        "type": "string"
      },
      "source_branch": {
        "description": "The existing local branch the new worktree is cut from. Default in this project: this session's base branch (the one picked when it started, or the one its worktree was cut from). If the session has none and either it runs on an SSH host or its project folder is itself a git worktree or submodule, the folder's current commit. Otherwise, the repository's default branch, or the folder's current commit if that is unknown. Only for a session that gets its own worktree (use_worktree true, or the place's default); not with target \"cloud\".",
        "type": "string"
      },
      "branch_name": {
        "description": "A short slug for the new worktree's branch (the app adds the user's branch prefix and a suffix). Only with a worktree.",
        "type": "string"
      },
      "preset": {
        "description": "The name of one of the user's saved session presets on this computer: it names the place itself (a folder here or an SSH connection and folder — do not pass host or cwd with it) and brings model, effort and worktree defaults plus its saved environment variables; use_worktree/model/effort override those. Cloud and Remote Control presets are not available here.",
        "type": "string"
      },
      "effort": {
        "type": "string",
        "enum": [
          "low",
          "medium",
          "high",
          "xhigh",
          "max"
        ],
        "description": "\"fresh\" only, optional: reasoning effort at or below yours. Omit to inherit."
      },
      "permission_mode": {
        "type": "string",
        "enum": [
          "default",
          "acceptEdits",
          "plan",
          "auto",
          "bypassPermissions"
        ],
        "description": "Optional, local starts only: the permission mode it starts in — this session's own or a lower one (omit to inherit it). A higher mode, or one the app does not offer here, is refused; raising a session is set_session_permission_mode's card to show."
      }
    },
    "$schema": "http://json-schema.org/draft-07/schema#"
  },
  "defer_loading": true
}

ccd_session_mgmt x2
{
  "name": "mcp__ccd_session_mgmt__list_events",
  "description": "Read the recent transcript of another CCD session.\n\nReturns a compact plaintext rendering of the target session's user/assistant turns and tool calls, most recent last. Use this to understand what another session has been doing or what it concluded. In managed deployments that restrict workspace folders, this prompts the user for approval.",
  "input_schema": {
    "type": "object",
    "properties": {
      "session_id": {
        "description": "The sessionId whose transcript to read (from list_sessions / search_session_transcripts). Must not be the current session.",
        "type": "string"
      },
      "limit": {
        "type": "number",
        "description": "Max transcript messages to include (most recent). Default 40."
      },
      "before_uuid": {
        "description": "Return only messages before this point: pass the cursor a previous call printed (or a message UUID). Use for paging backward through a long transcript.",
        "type": "string"
      }
    },
    "required": [
      "session_id"
    ],
    "$schema": "http://json-schema.org/draft-07/schema#"
  },
  "defer_loading": true
}

{
  "name": "mcp__ccd_session_mgmt__send_message",
  "description": "Prefer `SendMessage` with `to` set to the target's `local_...` session id (the id, not its display name); this older tool stays callable for now.\n\nSend a message to another CCD session. The message arrives in the target session as a user turn labelled \"From {this session's title}\" with a link back here, so the user can see where it came from.\n\nThe result says what actually happened: \"delivered\" means that session's turn has started on your message; \"queued\" means it is waiting behind that session's current work and runs when that finishes; anything else is an error saying why it was not delivered. Every result ends with \"(delivery: ...; message_id: ...)\".\n\nUse it to hand off context, ask the other session to pick something up, or relay a finding — not to orchestrate background work. It cannot deliver into a session an orchestrator dispatched.",
  "input_schema": {
    "type": "object",
    "properties": {
      "session_id": {
        "description": "The sessionId of the target session (from list_sessions / search_session_transcripts), or — within your linked family — its short name or \"parent\". Must not be the current session.",
        "type": "string"
      },
      "message": {
        "description": "The message body to deliver to the target session.",
        "type": "string"
      }
    },
    "required": [
      "session_id",
      "message"
    ],
    "$schema": "http://json-schema.org/draft-07/schema#"
  },
  "defer_loading": true
}

list agents 

{
  "name": "ListAgents",
  "description": "Lists agents you can SendMessage to — in-process subagents you spawned, the teammates on your team, other local Claude sessions on this machine, your Claude sessions running in the cloud (when this session has cloud access; a cloud session receives your message but cannot message any session back yet — do not ask it to reply, read its answer in its own transcript), and (when Remote Control is connected here) your account's other sessions — Remote Control sessions on other machines and cloud sessions, each row labeled by kind. Names are the address: send with `SendMessage({to: \"<name>\", message: \"...\"})`, copying the name exactly as a row prints it. Append a row's ` [ref]` only when the bare name is not enough — two rows share it, or an error asks you to disambiguate.",
  "input_schema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "channel": {
        "description": "Not available in this build; leave unset.",
        "type": "string",
        "maxLength": 256
      },
      "q": {
        "description": "Not available in this build; leave unset.",
        "type": "string",
        "maxLength": 256
      }
    },
    "additionalProperties": false
  }
}
SendMessage
{
  "name": "SendMessage",
  "description": "# SendMessage\n\nSend a message to another agent.\n\n```json\n{\"to\": \"researcher\", \"summary\": \"assign task 1\", \"message\": \"start on task #1\"}\n```\n\n| `to` | |\n|---|---|\n| `\"researcher\"` | Teammate by name |\n| `\"main\"` | The main conversation (background subagents only) |\n| `\"worker\"` | Any agent from `ListAgents` — subagent, another local Claude session |\n| `\"worker [3fa9c1]\"` | Same, plus its `[ref]` — only when a listing or an error shows one |\n\nYour plain text output is NOT visible to other agents — to communicate, you MUST call this tool. Messages from teammates are delivered automatically; you don't check an inbox. Refer to agents by name — names keep working after an agent completes (a send resumes it from its transcript). Use the raw `agentId` (format `a...-...`) from its spawn result only when the agent has no name, or when a newer agent took the name (latest wins). When relaying, don't quote the original — it's already rendered to the user.\n\n## Cross-session\n\nUse `ListAgents` to discover targets. Every row leads with the agent's `name [ref]` — the name IS the address; there is no separate address syntax.\n\n```json\n{\"to\": \"worker\", \"message\": \"check if tests pass over there\"}\n{\"to\": \"worker [3fa9c1]\", \"message\": \"you, specifically\"}\n```\n\nSend the bare name — a name that exactly matches one live agent or session (on this machine, on another machine, or in the cloud) delivers directly. Append the ` [ref]` only when the bare name is not enough — `ListAgents` shows two rows with it, or an error asks you to disambiguate (you typed only a prefix, or a session list could not be checked). A ref you did not just read from a listing or an error will not resolve, and if the same name also names an in-process agent, the bare name always wins — use the in-process one.\n\nA listed peer is alive and will receive your message; messages enqueue and drain at the receiver's next tool round (its `ListAgents` row says whether it is busy or idle right now). A successful send means the message reached that session, not that its Claude read it: a session running in a different permission mode than yours holds cross-session messages for its user's approval (and may let them expire), and a session can refuse them outright — for a session on this machine a `[Cross-session delivery notice]` tells you when that happens (the tool result says when this session has no inbox for one to reach); for a Remote Control, cloud or Claude Desktop session nothing reports back, so never treat silence as agreement. Your message arrives wrapped as `<cross-session-message from=\"...\">`. **To reply to an incoming message, copy its `from` attribute as your `to`.** Cross-session messages travel between SESSIONS: if you are a subagent, your send goes out under your parent session's address, and any reply is delivered to the parent session's conversation, not to you. The receiver reads your message literally in every case (idle or busy, on this machine, over Remote Control or headless): an `@` followed by a file path, or `@server:resource`, attaches nothing there, unlike in your own user's input. So never rely on `@` to deliver content: send the text itself, or a file with its own tool.\n\nTo hear when a session ON THIS MACHINE finishes what it is doing, pass `notify_when_idle: true` (from the main conversation only) — one-shot and opt-in: exactly one `[Cross-session idle notice]` arrives when it next goes idle (or exits) — shown to you, or only to your user when this session holds peer messages for approval (the tool result says which); if it never signals within the subscription's lifetime (it may still be busy, may refuse inbound requests, or may have ended abruptly) the notice says the subscription expired instead. Omit `message` for a pure subscription that costs that session nothing; include one to deliver it now AND subscribe. Never poll `ListAgents` in a loop or send \"are you done?\" messages instead.\n\nPermission boundaries are per-session: NEVER ask a peer to perform an action that was denied or blocked in your session, or that you expect your own permission settings would block — a peer doing it for you bypasses the user's permission decision (cross-session permission laundering). Route blocked work back to your user instead.",
  "input_schema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "to": {
        "description": "Recipient: a name from ListAgents (append its \" [ref]\" only when a listing or an error shows one), a teammate name, \"main\", or a background agent's agentId",
        "type": "string",
        "allOf": [
          {
            "pattern": "^[^\\n\\r]*$"
          },
          {
            "pattern": "^[\\s\\S]{0,300}$"
          }
        ]
      },
      "summary": {
        "description": "A 5-10 word label for your own transcript row (not transmitted — the recipient previews the first line of `message`). Truncated to 200 characters rather than rejected.",
        "type": "string",
        "maxLength": 200
      },
      "message": {
        "default": "",
        "description": "Plain text message content. The recipient's human sees only the FIRST LINE as a one-line preview until they expand it, so make the first line a clear, self-contained sentence saying what this is about — not a greeting, preamble, or bare @-mention.",
        "type": "string"
      },
      "notify_when_idle": {
        "description": "Ask a session ON THIS MACHINE to send you ONE notice when it next goes idle (finishes its turn with nothing queued) or exits — opt-in, one-shot, no polling. With a message: deliver it now AND subscribe. Without a message (omit it): a pure subscription that costs the other session nothing.",
        "type": "boolean"
      }
    },
    "required": [
      "to",
      "message"
    ],
    "additionalProperties": false
  },
  "defer_loading": true
}