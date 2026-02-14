---
name: session-memory
description: "Notify agent to archive session memories when /new command is issued"
homepage: https://docs.openclaw.ai/automation/hooks#session-memory
metadata:
  {
    "openclaw":
      {
        "emoji": "💾",
        "events": ["command:new"],
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with OpenClaw" }],
      },
  }
---

# Session Memory Hook

Notifies the agent to archive session memories when you issue the `/new` command.

## What It Does

When you run `/new` to start a fresh session:

1. **Sends a system event** - Injects a prompt into the session asking the agent to review and archive
2. **Agent decides** - The agent uses its full context (workspace files, memory, personality) to decide what's worth saving
3. **Human-quality archives** - Results in better memory files because the agent understands what matters

## Why This Approach

Previously, the hook used a cold-start LLM to generate slugs and write files directly. This had problems:

- No context about what's important
- Generated low-quality summaries
- Created files with meaningless slugs
- Didn't follow workspace conventions

Now the main agent handles archiving with full context:

- Knows the user's preferences
- Understands what's worth remembering
- Follows established file formats
- Can update existing files instead of creating new ones

## Output

The agent writes to `memory/YYYY-MM-DD.md` (or updates existing files) based on its judgment.

## Disabling

To disable this hook:

```bash
openclaw hooks disable session-memory
```

Or in config:

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "session-memory": { "enabled": false }
      }
    }
  }
}
```
