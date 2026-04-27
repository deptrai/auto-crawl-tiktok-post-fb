# Save Memory

Update sidecar memory to reflect the current session state.

Update `{project-root}/_bmad/memory/bmad-story-auditor-sidecar/index.md` with:
- `last_story_audited`: current story ID
- `pending_approval`: plan awaiting approval (if any), or null
- `last_updated`: today's date

Append to `audit-log.md`:
```
## {story-id} — {story-name}
Date: {today}
Findings: {N bugs, N gaps, N test gaps}
Fixed: {what was implemented}
Deferred: {what was left for later, if any}
Story design issues: {any flagged, or "none"}
```

If any recurring patterns were identified, append to `patterns.md`.

Confirm when done: "Memory saved."
