import { randomUUID } from 'node:crypto'
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
  createTemplate(params: { label: string; body: string; createdAt: string }): ContentTemplate
  updateTemplate(params: { id: string; label: string; body: string }): ContentTemplate | undefined
  deleteTemplate(id: string): number
  countTemplates(): number
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
  const stmtInsert = db.prepare<[string, string, string, string]>(
    `INSERT INTO content_templates(id, label, body, created_at)
     VALUES (?, ?, ?, ?)`
  )
  const stmtUpdate = db.prepare<[string, string, string]>(
    `UPDATE content_templates
     SET label = ?, body = ?
     WHERE id = ?`
  )
  const stmtGet = db.prepare<[string], ContentTemplateDbRow>(
    'SELECT id, label, body, created_at FROM content_templates WHERE id = ?'
  )
  const stmtDelete = db.prepare<[string]>('DELETE FROM content_templates WHERE id = ?')
  const stmtCount = db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM content_templates')

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
    },

    createTemplate(params) {
      const template = {
        id: randomUUID(),
        label: params.label,
        body: params.body,
        createdAt: params.createdAt
      }
      stmtInsert.run(template.id, template.label, template.body, template.createdAt)
      return template
    },

    updateTemplate(params) {
      const changes = Number(stmtUpdate.run(params.label, params.body, params.id).changes)
      if (changes === 0) return undefined
      const row = stmtGet.get(params.id)
      return row ? mapTemplate(row) : undefined
    },

    deleteTemplate(id) {
      return Number(stmtDelete.run(id).changes)
    },

    countTemplates() {
      return stmtCount.get()?.c ?? 0
    }
  }
}
