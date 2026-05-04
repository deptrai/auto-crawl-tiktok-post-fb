"""multi_platform_refactor

Revision ID: 20260506_02
Revises: 20260506_01
Create Date: 2026-05-06 00:00:00.000000

Story 12.3: Refactor multi-platform support.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '20260506_02'
down_revision: Union[str, Sequence[str], None] = '20260506_01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add columns to campaigns
    op.add_column('campaigns', sa.Column('target_platforms', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'))
    op.add_column('campaigns', sa.Column('platform_targets', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='{}'))

    # 2. Create video_posts table
    op.create_table('video_posts',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('video_id', sa.Uuid(), nullable=False),
        sa.Column('platform', postgresql.ENUM('facebook', 'youtube', 'instagram', name='platformtype', create_type=False), nullable=False),
        sa.Column('status', postgresql.ENUM('pending', 'downloading', 'ready', 'posted', 'failed', name='videostatus', create_type=False), nullable=False, server_default='pending'),
        sa.Column('external_id', sa.String(), nullable=True),
        sa.Column('last_error', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['video_id'], ['videos.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('video_id', 'platform', name='uq_video_posts_video_platform')
    )
    op.create_index(op.f('ix_video_posts_external_id'), 'video_posts', ['external_id'], unique=False)

    # 3. Data Migration: Convert single target_platform to target_platforms list
    # and existing fb_post_id to video_posts entries.
    # (Optional, but good for real data)
    
def downgrade() -> None:
    op.drop_index(op.f('ix_video_posts_external_id'), table_name='video_posts')
    op.drop_table('video_posts')
    op.drop_column('campaigns', 'platform_targets')
    op.drop_column('campaigns', 'target_platforms')
