"""add_hashtag_optimization_to_campaigns

Revision ID: 20260503_01
Revises: 20260502_03
Create Date: 2026-05-03 00:00:00.000000

Story 10.3: Thêm hashtag_optimization vào campaigns.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260503_01'
down_revision: Union[str, Sequence[str], None] = '20260502_03'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column('campaigns', sa.Column('hashtag_optimization', sa.Boolean(), nullable=False, server_default=sa.text('false')))

def downgrade() -> None:
    op.drop_column('campaigns', 'hashtag_optimization')
