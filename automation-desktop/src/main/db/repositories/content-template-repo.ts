import type Database from 'better-sqlite3-multiple-ciphers'

export interface ContentTemplate {
  id: string
  label: string
  body: string
  createdAt: string
}

interface ContentTemplateDbRow {
  id: string
  label: string
  body: string
  created_at: string
}

export interface ContentTemplateRepository {
  listTemplates(): ContentTemplate[]
  getRandomTemplate(rng?: () => number): ContentTemplate | undefined
  seedDefaults(createdAt: string): void
}

const DEFAULT_TEMPLATE = {
  id: 'default-self-comment',
  label: 'Mặc định',
  body: 'Bình luận tự động mẫu'
}

function mapTemplate(row: ContentTemplateDbRow): ContentTemplate {
  return { id: row.id, label: row.label, body: row.body, createdAt: row.created_at }
}

export function createContentTemplateRepository(db: Database.Database): ContentTemplateRepository {
  const stmtList = db.prepare<[], ContentTemplateDbRow>(
    'SELECT id, label, body, created_at FROM content_templates ORDER BY created_at ASC, id ASC'
  )
  const stmtSeed = db.prepare<[string, string, string, string]>(
    `INSERT OR IGNORE INTO content_templates(id, label, body, created_at)
     VALUES (?, ?, ?, ?)`
  )

  return {
    listTemplates() {
      return stmtList.all().map(mapTemplate)
    },

    getRandomTemplate(rng = Math.random) {
      const templates = this.listTemplates()
      if (templates.length === 0) return undefined
      const index = Math.min(templates.length - 1, Math.floor(rng() * templates.length))
      return templates[index]
    },

    seedDefaults(createdAt) {
      stmtSeed.run(DEFAULT_TEMPLATE.id, DEFAULT_TEMPLATE.label, DEFAULT_TEMPLATE.body, createdAt)
    }
  }
}
