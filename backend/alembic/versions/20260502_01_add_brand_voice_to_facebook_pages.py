"""add_brand_voice_to_facebook_pages

Revision ID: 20260502_01
Revises: 20260428_02
Create Date: 2026-05-02 00:00:00.000000

Story 10.1: Thêm brand_voice và brand_voice_preset vào facebook_pages.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260502_01'
down_revision: Union[str, Sequence[str], None] = '20260428_02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column('facebook_pages', sa.Column('brand_voice', sa.String(), nullable=True))
    op.add_column('facebook_pages', sa.Column('brand_voice_preset', sa.String(), nullable=False, server_default=sa.text("'casual'")))

def downgrade() -> None:
    op.drop_column('facebook_pages', 'brand_voice_preset')
    op.drop_column('facebook_pages', 'brand_voice')
