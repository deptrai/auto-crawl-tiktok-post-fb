# Known Patterns

## Orphaned "smart" functions
Stories 7.1-7.3: `check_all_tokens()` was designed with smart event deduplication but the cron job called `check_token_health()` directly. Watch for cases where a service function implements a required behavior (dedup, rate limiting, batching) that the caller bypasses by calling a lower-level function directly.
