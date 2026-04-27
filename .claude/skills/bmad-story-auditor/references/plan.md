# Plan Fixes

Turn audit findings into an actionable fix plan, then get approval before any code changes.

## Build the Plan

Group findings by type and produce a fix plan:

**Bugs** (wrong behavior vs. AC) — propose a concrete fix with:
- What to change and where (`file:line`)
- Why this change makes the AC pass
- Which tests need to update or be added

**Gaps** (AC not implemented) — propose an implementation plan with:
- What needs to be built (BE endpoint / FE component / DB change / test)
- Key design decisions and why
- Estimated scope (single function / multiple files / new migration)
- Dependencies on other gaps or bugs

**Test gaps** — list specifically what test cases are missing and where they should live.

## Plan Format

```
## Fix Plan: {story-id}

### Execution Order
{Sequence matters — list dependencies. Migrations before services, services before endpoints, endpoints before frontend.}

### Bugs to Fix ({N})

#### B1: {short title}
**File:** {path}
**Change:** {what to change}
**Tests:** {what to add/update}

### Gaps to Implement ({N})

#### G1: {short title}
**Scope:** {BE / FE / DB / Tests}
**Plan:** {what to build}
**Design notes:** {key decisions}

### Test Gaps ({N})

#### T1: {short title}
**Location:** {test file}
**Cases to add:** {specific test cases}

### Total effort estimate: {XS/S/M/L}
```

## Get Approval

Present the plan and ask: **"Approve this plan? Or adjust before I start?"**

Do not proceed to `./references/execute.md` until explicit approval is given.

If the user adjusts the plan, revise and confirm again before executing.
