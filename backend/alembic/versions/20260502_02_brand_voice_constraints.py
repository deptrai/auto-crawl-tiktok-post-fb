"""brand_voice_constraints

Revision ID: 20260502_02
Revises: 20260502_01
Create Date: 2026-05-02 10:00:00.000000

Story 10.1 Round 2 review patches:
- Cap brand_voice length to 500 chars at DB level (defense in depth).
- Add CHECK constraint for brand_voice_preset enum values.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '20260502_02'
down_revision: Union[str, Sequence[str], None] = '20260502_01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_PRESET_VALUES = ('professional', 'casual', 'gen-z', 'corporate', 'viral')


def upgrade() -> None:
    # Length cap on brand_voice (TEXT → VARCHAR(500)).
    op.alter_column(
        'facebook_pages', 'brand_voice',
        existing_type=sa.String(),
        type_=sa.String(500),
        existing_nullable=True,
    )
    op.alter_column(
        'facebook_pages', 'brand_voice_preset',
        existing_type=sa.String(),
        type_=sa.String(32),
        existing_nullable=False,
        existing_server_default=sa.text("'casual'"),
    )

    # Backfill any rogue values to 'casual' before applying the constraint.
    quoted_values = ", ".join(f"'{v}'" for v in _PRESET_VALUES)
    op.execute(
        f"UPDATE facebook_pages SET brand_voice_preset = 'casual' "
        f"WHERE brand_voice_preset NOT IN ({quoted_values}) "
        f"OR brand_voice_preset IS NULL"
    )

    op.create_check_constraint(
        'facebook_pages_brand_voice_preset_check',
        'facebook_pages',
        f"brand_voice_preset IN ({quoted_values})",
    )


def downgrade() -> None:
    op.drop_constraint('facebook_pages_brand_voice_preset_check', 'facebook_pages', type_='check')
    op.alter_column(
        'facebook_pages', 'brand_voice_preset',
        existing_type=sa.String(32),
        type_=sa.String(),
        existing_nullable=False,
        existing_server_default=sa.text("'casual'"),
    )
    op.alter_column(
        'facebook_pages', 'brand_voice',
        existing_type=sa.String(500),
        type_=sa.String(),
        existing_nullable=True,
    )
