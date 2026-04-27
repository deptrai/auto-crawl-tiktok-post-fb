# Autonomous Wake — Rex

Running headless. No interaction needed.

## Default behavior (no story specified)

Scan `{project-root}/_bmad-output/implementation-artifacts/` for all stories with status `done` or `in-progress` that have not been audited yet (check `audit-log.md` in sidecar). Audit each one and write findings to a report at `{project-root}/_bmad-output/audit-reports/{story-id}-audit.md`.

If all stories are already audited, check if any have been updated since last audit (compare story file modification date vs. audit date in log). Re-audit those.

## Named task: single story (`--headless:{story-id}`)

Audit only the specified story. Write report to `{project-root}/_bmad-output/audit-reports/{story-id}-audit.md`.

## Headless report format

Same as interactive audit report, plus at the top:

```
## Headless Audit — {datetime}
Story: {story-id}
Mode: autonomous
Action required: {yes — N findings need attention | no — all ACs pass}
```

Do not implement fixes headlessly — only report findings. Flag items that need attention clearly so the user knows what to review when they return.

## After completing

Update `audit-log.md` and `index.md` in sidecar.
