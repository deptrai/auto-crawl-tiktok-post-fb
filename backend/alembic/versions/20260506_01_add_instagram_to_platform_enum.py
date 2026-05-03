"""add_instagram_to_platform_enum

Revision ID: 20260506_01
Revises: 20260505_01
Create Date: 2026-05-06 00:00:00.000000

Story 12.2: Add instagram to PlatformType enum.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260506_01'
down_revision: Union[str, Sequence[str], None] = '20260505_01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE platformtype ADD VALUE IF NOT EXISTS 'instagram'")

def downgrade() -> None:
    # PostgreSQL doesn't support DROP VALUE for ENUMs.
    # To truly downgrade, one would need to recreate the type.
    raise NotImplementedError("PostgreSQL does not support dropping ENUM values. Downgrade must be handled manually if required.")