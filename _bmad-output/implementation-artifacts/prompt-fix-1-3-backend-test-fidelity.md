# Dev Fix Prompt — Story 1.3 Backend Test Fidelity (PostgreSQL)

> Dán prompt này cho dev agent (Codex/Claude). Story 1.3 logic ĐÃ ĐÚNG (live API smoke trên Postgres thật pass 5/5 path) — chỉ cần sửa **test fidelity**, KHÔNG sửa business logic.

---

## Bối cảnh

Story 1.3 (`backend/app/api/automation.py`, `services/automation/license.py`, `models/automation/license.py`, migration `20260602_01_phase3_license_init.py`) đã implement đúng. Live API smoke bằng curl trên PostgreSQL thật + Alembic migration thật đã PASS 5/5 path (activate success, idempotent, HWID mismatch 409, revoked 403, not-found 404; error có `retryable` + message tiếng Việt).

**Vấn đề duy nhất**: backend test cho Phase 3 chạy trên SQLite, không trung thực với production Postgres. Có 4 review findings cần fix (xem `1-3-activate-license-voi-hwid-binding.md` § Review Findings).

## Mục tiêu

Sửa backend test setup để Phase 3 test chạy trên **PostgreSQL thật + Alembic migration thật**, và **gỡ production pollution**.

## Nhiệm vụ cụ thể

### 1. Gỡ test-only logic khỏi production `app/core/database.py` (Critical)

Xóa hoàn toàn:
- Hàm `_phase3_sqlite_path(...)`
- Event listener `_attach_phase3_schema` + nhánh `if settings.DATABASE_URL.startswith("sqlite")`

`database.py` chỉ giữ engine setup production thuần (Postgres). KHÔNG có SQLite ATTACH/schema hack.

### 2. Tạo test infra PostgreSQL cho automation tests (Critical)

Chọn 1 trong 2 (ưu tiên A nếu môi trường CI có Docker):

**Option A — testcontainers-python** (khuyến nghị):
- Thêm `testcontainers[postgres]` vào `backend/requirements-dev.txt` (hoặc requirements test)
- Fixture spin up Postgres ephemeral, set `DATABASE_URL` trỏ vào nó
- Chạy `alembic upgrade head` trong fixture setup (KHÔNG `Base.metadata.create_all`)

**Option B — PG test DB từ docker-compose** (nếu không muốn thêm dep):
- Dùng service `db` trong `docker-compose.yml` (port 5433, user admin, db medirus_db) hoặc tạo DB test riêng `medirus_test`
- Fixture connect + `alembic upgrade head` + truncate giữa các test

### 3. Tách conftest cho automation tests (Major)

- KHÔNG phá Phase 1+2 test (đang dùng SQLite — giữ nguyên cho chúng).
- Tạo marker `@pytest.mark.postgres` hoặc conftest riêng trong `backend/tests/automation/` cho Phase 3 test.
- Automation test fixture: PG thật + Alembic migration + rollback/truncate an toàn giữa test.

### 4. Sửa `test_automation_license.py` (Major)

- XÓA nhánh `if bind.dialect.name == "sqlite"` trong `test_phase3_license_tables_exist` — chỉ giữ nhánh Postgres (query `information_schema.tables WHERE table_schema='phase3'`).
- Thêm test verify **FK enforcement** thật: insert `license_activations` với `license_id` không tồn tại → phải fail FK constraint (chứng minh FK cross-schema hoạt động trên Postgres — điều SQLite ATTACH không catch).
- Thêm assert migration đã chạy: `phase3.licenses` + `phase3.license_activations` tồn tại qua `information_schema`.

### 5. CI (rule #24 — root)

- Đảm bảo job test backend Phase 3 trong root `.github/workflows/ci.yml` có Postgres service (GitHub Actions `services: postgres:`) + chạy `alembic upgrade head` trước pytest automation.

## Acceptance (Definition of Done)

- [ ] `app/core/database.py` KHÔNG còn SQLite ATTACH/`_phase3_*` logic
- [ ] Automation test chạy trên Postgres thật + `alembic upgrade head` (không `create_all`)
- [ ] `test_automation_license.py` không còn nhánh `if sqlite`
- [ ] Có test FK enforcement cross-schema
- [ ] Phase 1+2 test (SQLite) vẫn pass, không bị ảnh hưởng
- [ ] CI có Postgres service cho automation test job
- [ ] `pytest backend/tests/automation/` pass trên Postgres
- [ ] Business logic (`license.py`, router, model, migration) KHÔNG đổi — chỉ test infra

## Tham chiếu

- Rule: `_bmad-output/project-context.md` § Testing Rules (Phase 3 backend test PostgreSQL)
- Memory: `phase3-review-rules`
- Story: `1-3-activate-license-voi-hwid-binding.md` § Review Findings
- Live smoke đã verify logic đúng — KHÔNG cần đổi logic, chỉ test fidelity
