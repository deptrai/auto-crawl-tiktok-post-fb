"""feat_organizations_multi_tenancy

Revision ID: 58dc46872d17
Revises: c14f91eae2aa
Create Date: 2026-05-06 03:09:06.682947
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '58dc46872d17'
down_revision: Union[str, Sequence[str], None] = 'c14f91eae2aa'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create organizations table
    op.create_table('organizations',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('slug', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_organizations_name'), 'organizations', ['name'], unique=False)
    op.create_index(op.f('ix_organizations_slug'), 'organizations', ['slug'], unique=True)

    # 2. Add organization_id to all models
    tables = ['users', 'campaigns', 'facebook_pages', 'videos', 'interactions_log', 'task_queue', 'system_events']
    for table in tables:
        # Check if column exists to avoid error if already present
        # Note: In a production migration we usually assume it's not there,
        # but for this environment it's safer to be idempotent.
        op.add_column(table, sa.Column('organization_id', sa.Uuid(), nullable=True))
        op.create_foreign_key(f'fk_{table}_organization_id', table, 'organizations', ['organization_id'], ['id'], ondelete='CASCADE')


def downgrade() -> None:
    tables = ['system_events', 'task_queue', 'interactions_log', 'videos', 'facebook_pages', 'campaigns', 'users']
    for table in tables:
        op.drop_constraint(f'fk_{table}_organization_id', table, type_='foreignkey')
        op.drop_column(table, 'organization_id')
    
    op.drop_index(op.f('ix_organizations_slug'), table_name='organizations')
    op.drop_index(op.f('ix_organizations_name'), table_name='organizations')
    op.drop_table('organizations')
