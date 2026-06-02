"""phase3 license init

Revision ID: 20260602_01_phase3_license_init
Revises: 58dc46872d17
Create Date: 2026-06-02 00:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260602_01_phase3_license_init"
down_revision: Union[str, Sequence[str], None] = "58dc46872d17"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS phase3")
    op.execute("SET search_path TO phase3, public")

    op.create_table(
        "licenses",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("days_total", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("created_by_admin", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.CheckConstraint("days_total > 0", name="ck_licenses_days_total_positive"),
        sa.ForeignKeyConstraint(["created_by_admin"], ["public.users.id"]),
        sa.PrimaryKeyConstraint("id"),
        schema="phase3",
    )
    op.create_index("uq_licenses_key", "licenses", ["key"], unique=True, schema="phase3")

    op.create_table(
        "license_activations",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("license_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("hwid_hash", sa.String(length=64), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rebind_count", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["license_id"], ["phase3.licenses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("license_id", name="uq_license_activations_license_id"),
        schema="phase3",
    )
    op.create_index(
        "idx_license_activations_hwid",
        "license_activations",
        ["hwid_hash"],
        unique=False,
        schema="phase3",
    )
    op.execute("RESET search_path")


def downgrade() -> None:
    op.drop_index("idx_license_activations_hwid", table_name="license_activations", schema="phase3")
    op.drop_table("license_activations", schema="phase3")
    op.drop_index("uq_licenses_key", table_name="licenses", schema="phase3")
    op.drop_table("licenses", schema="phase3")
    op.execute("DROP SCHEMA IF EXISTS phase3 RESTRICT")
