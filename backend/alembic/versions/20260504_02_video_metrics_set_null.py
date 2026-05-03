"""video_metrics_video_id_set_null

Revision ID: 20260504_02
Revises: 20260504_01
Create Date: 2026-05-04 11:00:00.000000

Story 11.1 Round 2 review patch:
- Đổi `video_metrics.video_id` FK từ ON DELETE CASCADE → SET NULL.
- Lý do: spec yêu cầu lưu time-series history. Nếu Video bị xóa (admin),
  CASCADE sẽ mất toàn bộ snapshots → mất data analytics. SET NULL giữ rows,
  chỉ mất tham chiếu Video object.
- Đồng thời cho phép `video_id` nullable.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '20260504_02'
down_revision: Union[str, Sequence[str], None] = '20260504_01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Allow NULL on video_id để hỗ trợ SET NULL.
    op.alter_column('video_metrics', 'video_id', existing_type=sa.Uuid(), nullable=True)
    # Drop FK cũ (CASCADE) và recreate với SET NULL.
    # Lưu ý: alembic auto-name FK constraint thường là `video_metrics_video_id_fkey` trên Postgres.
    op.drop_constraint('video_metrics_video_id_fkey', 'video_metrics', type_='foreignkey')
    op.create_foreign_key(
        'video_metrics_video_id_fkey',
        'video_metrics',
        'videos',
        ['video_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('video_metrics_video_id_fkey', 'video_metrics', type_='foreignkey')
    op.create_foreign_key(
        'video_metrics_video_id_fkey',
        'video_metrics',
        'videos',
        ['video_id'],
        ['id'],
        ondelete='CASCADE',
    )
    op.alter_column('video_metrics', 'video_id', existing_type=sa.Uuid(), nullable=False)
