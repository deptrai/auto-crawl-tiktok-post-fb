"""add_caption_language_to_campaigns

Revision ID: 20260502_03
Revises: 20260502_02
Create Date: 2026-05-02 00:00:00.000000

Story 10.2: Thêm caption_language vào campaigns.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260502_03'
down_revision: Union[str, Sequence[str], None] = '20260502_02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column('campaigns', sa.Column('caption_language', sa.String(length=16), nullable=False, server_default=sa.text("'auto'")))
    # Thêm CheckConstraint
    op.create_check_constraint(
        'campaigns_caption_language_check',
        'campaigns',
        sa.column('caption_language').in_(['vi', 'en', 'auto'])
    )

def downgrade() -> None:
    op.drop_constraint('campaigns_caption_language_check', 'campaigns')
    op.drop_column('campaigns', 'caption_language')
