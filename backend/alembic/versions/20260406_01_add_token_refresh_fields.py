"""add_token_refresh_fields

Revision ID: 20260406_01
Revises: 53457421ab4c
Create Date: 2026-04-06 00:00:00.000000

Story 7.2: Thêm các field hỗ trợ auto-refresh long-lived token vào facebook_pages.
- user_access_token: lưu User Token (encrypted) để dùng trong refresh flow
- auto_refresh_enabled: Admin bật/tắt auto-refresh
- token_refresh_error: lưu thông báo lỗi refresh gần nhất
- last_refresh_at: thời điểm refresh token thành công gần nhất
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260406_01'
down_revision: Union[str, Sequence[str], None] = '53457421ab4c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('facebook_pages', sa.Column('user_access_token', sa.String(), nullable=True))
    op.add_column('facebook_pages', sa.Column('auto_refresh_enabled', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('facebook_pages', sa.Column('token_refresh_error', sa.String(), nullable=True))
    op.add_column('facebook_pages', sa.Column('last_refresh_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('facebook_pages', 'last_refresh_at')
    op.drop_column('facebook_pages', 'token_refresh_error')
    op.drop_column('facebook_pages', 'auto_refresh_enabled')
    op.drop_column('facebook_pages', 'user_access_token')
