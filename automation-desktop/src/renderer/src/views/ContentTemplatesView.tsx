import { useEffect, useState } from 'react'
import type { ContentTemplateSummary } from '../../../shared/ipc-schemas'
import {
  CONTENT_TEMPLATE_PLACEHOLDERS,
  renderContentTemplate,
  type ContentTemplateVars
} from '../../../shared/content-template-render'
import {
  createContentTemplate,
  deleteContentTemplate,
  listContentTemplates,
  updateContentTemplate
} from '../api/content-template-api'
import { EmptyState } from '../components/EmptyState'

const SAMPLE_TEMPLATE_VARS: Required<ContentTemplateVars> = {
  uid: '100012345678',
  name: 'Nguyễn Văn A'
}

const placeholderHint = `Placeholder hỗ trợ: ${CONTENT_TEMPLATE_PLACEHOLDERS.join(', ')}`

export function ContentTemplatesView(): React.JSX.Element {
  const [templates, setTemplates] = useState<ContentTemplateSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editBody, setEditBody] = useState('')
  const [rowBusyId, setRowBusyId] = useState<string | null>(null)
  const createPreview = body.trim() ? renderContentTemplate(body, SAMPLE_TEMPLATE_VARS) : ''
  const editPreview = editBody.trim() ? renderContentTemplate(editBody, SAMPLE_TEMPLATE_VARS) : ''

  async function refreshTemplates(): Promise<void> {
    try {
      const next = await listContentTemplates()
      setTemplates(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải template bình luận.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const next = await listContentTemplates()
        if (!cancelled) {
          setTemplates(next)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Không thể tải template bình luận.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCreate(): Promise<void> {
    const nextLabel = label.trim()
    const nextBody = body.trim()
    if (!nextLabel || !nextBody || saving) return

    setSaving(true)
    setError(null)
    try {
      await createContentTemplate({ label: nextLabel, body: nextBody })
      setLabel('')
      setBody('')
      await refreshTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể thêm template.')
    } finally {
      setSaving(false)
    }
  }

  function startEdit(template: ContentTemplateSummary): void {
    setError(null)
    setEditingId(template.id)
    setEditLabel(template.label)
    setEditBody(template.body)
  }

  async function handleUpdate(template: ContentTemplateSummary): Promise<void> {
    const nextLabel = editLabel.trim()
    const nextBody = editBody.trim()
    if (!nextLabel || !nextBody || rowBusyId) return

    setRowBusyId(template.id)
    setError(null)
    try {
      await updateContentTemplate({ id: template.id, label: nextLabel, body: nextBody })
      setEditingId(null)
      await refreshTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể sửa template.')
    } finally {
      setRowBusyId(null)
    }
  }

  async function handleDelete(template: ContentTemplateSummary): Promise<void> {
    if (rowBusyId) return
    if (templates.length <= 1) {
      setError('Cần ít nhất 1 template để chạy self-comment.')
      return
    }

    setRowBusyId(template.id)
    setError(null)
    try {
      await deleteContentTemplate(template.id)
      if (editingId === template.id) setEditingId(null)
      await refreshTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa template.')
    } finally {
      setRowBusyId(null)
    }
  }

  return (
    <section className="templates-panel" data-testid="content-templates-view">
      <div className="profiles-list-header">
        <div>
          <p className="eyebrow">Self-comment</p>
          <h2>Template bình luận</h2>
          <p className="profiles-list-subtitle">Quản lý nội dung random khi chạy tự bình luận.</p>
        </div>
        {loading ? (
          <span className="profiles-list-loading" data-testid="content-templates-loading">
            Đang tải template...
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="error-message list-error" data-testid="content-templates-error">
          {error}
        </p>
      ) : null}

      {!loading && !error && templates.length === 0 ? (
        <EmptyState
          icon="✎"
          title="Chưa có template nào."
          description="Thêm ít nhất một template để self-comment có nội dung random."
          testId="content-templates-empty"
        />
      ) : null}

      <div className="template-form" data-testid="content-template-form">
        <label className="field-label template-field-label" htmlFor="template-label">
          Nhãn
          <input
            id="template-label"
            data-testid="content-template-label-input"
            className="license-input"
            value={label}
            disabled={saving}
            maxLength={120}
            placeholder="Ví dụ: Khen nhẹ"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="field-label template-field-label" htmlFor="template-body">
          Nội dung
          <textarea
            id="template-body"
            data-testid="content-template-body-input"
            className="import-textarea template-body-input"
            value={body}
            disabled={saving}
            maxLength={2000}
            placeholder="Nội dung bình luận"
            rows={3}
            onChange={(e) => setBody(e.target.value)}
          />
          <span
            className="template-placeholder-hint"
            data-testid="content-template-placeholder-hint"
          >
            {placeholderHint}
          </span>
        </label>
        {createPreview ? (
          <div className="template-preview" data-testid="content-template-preview">
            <span>Xem trước</span>
            <p>{createPreview}</p>
          </div>
        ) : null}
        <button
          data-testid="content-template-create-button"
          className="primary-button"
          type="button"
          disabled={saving || !label.trim() || !body.trim()}
          onClick={(e) => {
            ;(e.currentTarget as HTMLButtonElement).disabled = true
            void handleCreate()
          }}
        >
          {saving ? 'Đang thêm...' : 'Thêm template'}
        </button>
      </div>

      {templates.length > 0 ? (
        <ul className="template-list" data-testid="content-templates-list">
          {templates.map((template) => {
            const isEditing = editingId === template.id
            const isBusy = rowBusyId === template.id
            return (
              <li
                className="template-row"
                data-testid={`content-template-row-${template.id}`}
                key={template.id}
              >
                {isEditing ? (
                  <div className="template-edit-form">
                    <input
                      className="profile-edit-input"
                      data-testid={`content-template-edit-label-${template.id}`}
                      value={editLabel}
                      disabled={isBusy}
                      maxLength={120}
                      onChange={(e) => setEditLabel(e.target.value)}
                    />
                    <textarea
                      className="import-textarea template-edit-body"
                      data-testid={`content-template-edit-body-${template.id}`}
                      value={editBody}
                      disabled={isBusy}
                      maxLength={2000}
                      rows={3}
                      onChange={(e) => setEditBody(e.target.value)}
                    />
                    <span
                      className="template-placeholder-hint"
                      data-testid="content-template-edit-placeholder-hint"
                    >
                      {placeholderHint}
                    </span>
                    {editPreview ? (
                      <div className="template-preview" data-testid="content-template-edit-preview">
                        <span>Xem trước</span>
                        <p>{editPreview}</p>
                      </div>
                    ) : null}
                    <div className="profile-row-actions">
                      <button
                        className="profile-row-button primary-row-action"
                        data-testid={`content-template-save-${template.id}`}
                        type="button"
                        disabled={isBusy || !editLabel.trim() || !editBody.trim()}
                        onClick={(e) => {
                          ;(e.currentTarget as HTMLButtonElement).disabled = true
                          void handleUpdate(template)
                        }}
                      >
                        {isBusy ? 'Đang lưu...' : 'Lưu'}
                      </button>
                      <button
                        className="profile-row-button"
                        data-testid={`content-template-cancel-${template.id}`}
                        type="button"
                        disabled={isBusy}
                        onClick={() => setEditingId(null)}
                      >
                        Hủy
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="template-content">
                      <strong>{template.label}</strong>
                      <p>{template.body}</p>
                    </div>
                    <div className="profile-row-actions">
                      <button
                        className="profile-row-button"
                        data-testid={`content-template-edit-${template.id}`}
                        type="button"
                        disabled={isBusy}
                        onClick={() => startEdit(template)}
                      >
                        Sửa
                      </button>
                      <button
                        className="profile-row-button danger-row-action"
                        data-testid={`content-template-delete-${template.id}`}
                        type="button"
                        disabled={isBusy || templates.length <= 1}
                        title={
                          templates.length <= 1
                            ? 'Cần ít nhất 1 template để chạy self-comment.'
                            : undefined
                        }
                        onClick={(e) => {
                          ;(e.currentTarget as HTMLButtonElement).disabled = true
                          void handleDelete(template)
                        }}
                      >
                        {isBusy ? 'Đang xóa...' : 'Xóa'}
                      </button>
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
