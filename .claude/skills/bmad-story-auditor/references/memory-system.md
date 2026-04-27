# Memory System — Rex

Memory lives at `{project-root}/_bmad/memory/bmad-story-auditor-sidecar/`.

## Files

- `index.md` — loaded on every activation; contains active audit state, last story audited, pending approvals
- `audit-log.md` — chronological record of all audits: story, date, findings summary, what was fixed
- `patterns.md` — recurring issues found across stories (helps Rex spot known patterns faster)

## Discipline

**Save after:** completing an audit, getting approval on a plan, completing execution, or at any explicit user request.

**What to record in index.md:**
- Last audited story and its current state (audit done / plan approved / execution done)
- Any pending approvals (plan waiting for user sign-off)
- Active session context if mid-audit

**What to record in audit-log.md:**
- Story ID and name
- Date of audit
- Findings summary (N bugs, N gaps, N test gaps)
- What was fixed vs. deferred
- Any story design issues flagged

**What to record in patterns.md:**
- Bug patterns that appear across multiple stories (e.g., "FE state not refreshed after BE call")
- AC patterns that are commonly under-tested
- Story design issues that recur

## Loading

Load `index.md` on activation. Load `audit-log.md` and `patterns.md` only when directly relevant (reviewing history, checking for known patterns before audit).

Do not load all three files on every activation — index.md is the entry point.
