# Audit Story

Perform a full implementation audit of the target story against its acceptance criteria. Every AC is a contract — partial passes are failures.

## Locate the Story

Find the story file in `{project-root}/_bmad-output/implementation-artifacts/`. Accept fuzzy match on the story ID or name the user provided (e.g. "7.3", "7-3", "canh-bao"). Read the full story file before doing anything else.

**If the story file is not found:** report immediately and stop.

**While reading the story, flag design issues immediately** — contradictions between ACs, missing context that would make implementation ambiguous, ACs that conflict with each other, or requirements that seem technically unsound. Don't wait until the audit is complete. Surface these now.

## Trace Implementation

For each story, identify all code components that should implement it. Use the code-review-graph MCP first (`semantic_search_nodes`, `query_graph callers_of/tests_for`); fall back to grep/glob if the graph doesn't resolve a component.

Cover all layers:
- **Backend**: API endpoints, services, models, DB migrations, scheduler jobs
- **Frontend**: components, state management, API calls, UI rendering
- **Tests**: unit tests, integration tests — both backend and frontend

Use the story's own task list and technical context sections as a map of what was planned. Cross-reference against what exists.

## Evaluate Each AC

For every Acceptance Criterion:

1. Locate the code that implements it
2. Verify the implementation matches the AC precisely — not approximately
3. Check test coverage for that specific behavior
4. Verdict: **PASS**, **FAIL**, or **PARTIAL** with specific evidence

A FAIL is: AC not implemented, wrong behavior, or no test coverage.
A PARTIAL is: core behavior present but edge cases, error paths, or secondary behaviors missing.

## Report Format

Produce a structured audit report:

```
## Audit: {story-id} — {story-name}

### Story Design Issues
{Any contradictions, ambiguities, or design problems found — list immediately, empty section if none}

### Summary
- ACs passing: X / total
- Bugs found: N (wrong behavior vs. AC)
- Gaps found: N (AC not implemented)
- Test coverage gaps: N

### Findings

#### [FAIL/PARTIAL] AC{N}: {AC title}
**Expected:** {what the AC requires}
**Actual:** {what the code does}
**Location:** {file:line}
**Type:** bug | gap | missing-test
**Severity:** critical | high | medium | low

{repeat for each finding}

### Passing ACs
{brief confirmation of what's working correctly}
```

After the report, load `./references/plan.md` to propose fixes.
