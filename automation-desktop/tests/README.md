# Test Suite Guide

## Structure

- `tests/e2e/`: end-to-end smoke and user-flow tests
- `tests/integration/`: cross-module integration tests
- `tests/api/`: API/contract-oriented tests
- `tests/component/`: component-level behavior tests
- `tests/unit/`: isolated logic tests
- `tests/support/fixtures/`: `test.extend()` fixtures
- `tests/support/factories/`: faker-backed test data factories
- `tests/support/helpers/`: generic helpers (`waitFor`, `retry`, assertions)

## Run Commands

- `npm run test:unit`
- `npm run test:integration`
- `npm run test:api`
- `npm run test:component`
- `npm run test:e2e`
- `npm run test:e2e:p0`
- `npm run test:automation`

## Priority Tags

- `[P0]`: critical path
- `[P1]`: high value integration/contract
- `[P2]`: edge and secondary behavior
- `[P3]`: optional exploratory

## Writing Conventions

- Use Given/When/Then comments for test readability.
- Avoid hard waits and conditional flow logic.
- Prefer factories over hardcoded dynamic test data.
- Keep tests isolated and deterministic.
