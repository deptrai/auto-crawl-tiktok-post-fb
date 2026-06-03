"""phase3 action tokens

Revision ID: 20260603_01_phase3_action_tokens
Revises: 20260602_01_phase3_license_init
Create Date: 2026-06-03 00:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260603_01_phase3_action_tokens"
down_revision: Union[str, Sequence[str], None] = "20260602_01_phase3_license_init"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS phase3")
    op.create_table(
        "action_tokens",
        sa.Column("jti", sa.String(), nullable=False),
        sa.Column("license_activation_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("action_type", sa.String(), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["license_activation_id"], ["phase3.license_activations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("jti"),
        schema="phase3",
    )
    op.create_index("uq_action_tokens_jti", "action_tokens", ["jti"], unique=True, schema="phase3")
    op.create_index(
        "idx_action_tokens_activation",
        "action_tokens",
        ["license_activation_id"],
        unique=False,
        schema="phase3",
    )


def downgrade() -> None:
    op.drop_index("idx_action_tokens_activation", table_name="action_tokens", schema="phase3")
    op.drop_index("uq_action_tokens_jti", table_name="action_tokens", schema="phase3")
    op.drop_table("action_tokens", schema="phase3")
