"""add_campaign_keyword_filter_fields

Revision ID: 20260428_02
Revises: 20260428_01
Create Date: 2026-04-28 00:00:00.000000

Story 9.2: Thêm keyword filter fields vào campaigns.
- filter_blocklist_keywords: JSON array of blocked keywords (default [])
- filter_allowlist_hashtags: JSON array of allowed hashtags (default [])
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '20260428_02'
down_revision: Union[str, Sequence[str], None] = '20260428_01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'campaigns',
        sa.Column(
            'filter_blocklist_keywords',
            sa.JSON().with_variant(postgresql.JSONB, "postgresql"),
            nullable=True,
            server_default=sa.text("'[]'"),
        ),
    )
    op.add_column(
        'campaigns',
        sa.Column(
            'filter_allowlist_hashtags',
            sa.JSON().with_variant(postgresql.JSONB, "postgresql"),
            nullable=True,
            server_default=sa.text("'[]'"),
        ),
    )


def downgrade() -> None:
    op.drop_column('campaigns', 'filter_allowlist_hashtags')
    op.drop_column('campaigns', 'filter_blocklist_keywords')
