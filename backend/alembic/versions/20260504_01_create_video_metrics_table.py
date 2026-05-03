"""create_video_metrics_table

Revision ID: 20260504_01
Revises: 20260503_01
Create Date: 2026-05-04 00:00:00.000000

Story 11.1: Tạo bảng video_metrics
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '20260504_01'
down_revision: Union[str, Sequence[str], None] = '20260503_01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.create_table(
        'video_metrics',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('video_id', sa.Uuid(), nullable=False),
        sa.Column('fb_post_id', sa.String(), nullable=False),
        sa.Column('views', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('likes', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('comments', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('shares', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('reach', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('fetched_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['video_id'], ['videos.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_video_metrics_fb_post_id'), 'video_metrics', ['fb_post_id'], unique=False)
    op.create_index('ix_video_metrics_video_fetched', 'video_metrics', ['video_id', 'fetched_at'], unique=False)

def downgrade() -> None:
    op.drop_index('ix_video_metrics_video_fetched', table_name='video_metrics')
    op.drop_index(op.f('ix_video_metrics_fb_post_id'), table_name='video_metrics')
    op.drop_table('video_metrics')
