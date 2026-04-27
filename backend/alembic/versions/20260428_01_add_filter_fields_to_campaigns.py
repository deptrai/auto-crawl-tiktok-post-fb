"""add_filter_fields_to_campaigns

Revision ID: 20260428_01
Revises: 20260406_01
Create Date: 2026-04-28 00:00:00.000000

Story 9.1: Thêm content-quality filter fields vào campaigns.
- filter_min_views: ngưỡng view tối thiểu (0 = không lọc)
- filter_min_likes: ngưỡng like tối thiểu (0 = không lọc)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '20260428_01'
down_revision: Union[str, Sequence[str], None] = '20260406_01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'campaigns',
        sa.Column('filter_min_views', sa.Integer(), nullable=False, server_default=sa.text('0')),
    )
    op.add_column(
        'campaigns',
        sa.Column('filter_min_likes', sa.Integer(), nullable=False, server_default=sa.text('0')),
    )


def downgrade() -> None:
    op.drop_column('campaigns', 'filter_min_likes')
    op.drop_column('campaigns', 'filter_min_views')
