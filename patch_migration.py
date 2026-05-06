from sqlalchemy.engine.reflection import Inspector

def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    
    # 1. Create organizations table if not exists
    if not inspector.has_table('organizations'):
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
        if inspector.has_table(table):
            columns = [col['name'] for col in inspector.get_columns(table)]
            if 'organization_id' not in columns:
                op.add_column(table, sa.Column('organization_id', sa.Uuid(), nullable=True))
                op.create_foreign_key(f'fk_{table}_organization_id', table, 'organizations', ['organization_id'], ['id'], ondelete='CASCADE')
