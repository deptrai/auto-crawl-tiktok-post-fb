"""add_youtube_integration

Revision ID: 20260505_01
Revises: 20260504_02
Create Date: 2026-05-05 00:00:00.000000

Story 12.1: Add YouTubeChannel table and target_platform to Campaign.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '20260505_01'
down_revision: Union[str, Sequence[str], None] = '20260504_02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create ENUM for target_platform
    platform_type_enum = postgresql.ENUM('facebook', 'youtube', name='platformtype')
    platform_type_enum.create(op.get_bind(), checkfirst=True)
    
    # 2. Add target_platform to campaigns
    op.add_column('campaigns', sa.Column('target_platform', platform_type_enum, nullable=False, server_default='facebook'))

    # 3. Create youtube_channels table
    op.create_table('youtube_channels',
        sa.Column('channel_id', sa.String(), nullable=False),
        sa.Column('channel_name', sa.String(), nullable=True),
        sa.Column('access_token', sa.String(), nullable=False),
        sa.Column('refresh_token', sa.String(), nullable=True),
        sa.Column('token_expires_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.PrimaryKeyConstraint('channel_id')
    )


def downgrade() -> None:
    op.drop_table('youtube_channels')
    op.drop_column('campaigns', 'target_platform')
    # Optional: drop ENUM if not used by anything else
    op.execute("DROP TYPE platformtype;")