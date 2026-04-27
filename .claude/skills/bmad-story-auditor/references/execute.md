# Execute Fixes

Implement the approved fix plan. Work through items in the sequence specified by the plan — dependencies first.

## Execution Rules

- Implement exactly what was approved. If you discover mid-execution that a fix is more complex than planned, stop and report before continuing.
- For each item: implement, then immediately verify it compiles/passes relevant tests before moving to the next.
- Bugs and test gaps first (low risk, isolated). Gaps last (higher scope, may touch multiple files).
- If a DB migration is needed, write it before the service layer changes that depend on it.

## Per-Item Checklist

For each fix/gap implemented:
1. Make the change
2. Run relevant tests to confirm the AC now passes
3. Confirm no regressions in adjacent tests
4. Report: "B1 done — `file:line` changed, test passes"

## Running Tests

Backend tests: `cd backend && python -m pytest {relevant test file or module} -v`
Frontend: check if the story references any FE test tooling; if not, verify by reading the component logic against the AC.

## After Execution

Once all items are done:
1. Run the full test suite for the affected areas
2. Produce a completion report:

```
## Execution Complete: {story-id}

### Implemented
{list each item with file changed and test status}

### Test Results
{pass/fail summary}

### Remaining (if any)
{anything that couldn't be completed and why}
```

3. Load `./references/save-memory.md` to record the audit session.
