import { useEffect, useState } from 'react'
import type { ContentTemplateSummary } from '../../../shared/ipc-schemas'
import { listContentTemplates } from '../api/content-template-api'

export function BulkActionBar({
  count,
  disabled,
  headless,
  target,
  onHeadlessChange,
  onRun,
  onTargetChange
}: {
  count: number
  disabled: boolean
  headless: boolean
  target: string
  onHeadlessChange: (next: boolean) => void
  onRun: () => void
  onTargetChange: (target: string) => void
}): React.JSX.Element {
  const [templates, setTemplates] = useState<ContentTemplateSummary[]>([])

  useEffect(() => {
    let cancelled = false
    void listContentTemplates()
      .then((next) => {
        if (!cancelled) setTemplates(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      className="bulk-action-bar"
      data-testid="bulk-action-bar"
      role="region"
      aria-label="Hành động hàng loạt"
    >
      <strong>Đã chọn {count}</strong>
      <label className="bulk-field" htmlFor="bulk-target-input">
        URL post
        <input
          id="bulk-target-input"
          data-testid="bulk-target-input"
          value={target}
          placeholder="https://www.facebook.com/.../posts/..."
          onChange={(event) => onTargetChange(event.target.value)}
        />
      </label>
      <label className="bulk-field" htmlFor="bulk-template-select">
        Template
        <select id="bulk-template-select" data-testid="bulk-template-select" defaultValue="random">
          <option value="random">Random tất cả</option>
          {templates.map((template) => (
            <option
              key={template.id}
              value={template.id}
              disabled
              title="Cần mở rộng IPC (story sau)"
            >
              {template.label}
            </option>
          ))}
        </select>
      </label>
      <label className="bulk-headless-toggle" htmlFor="bulk-headless-toggle">
        <input
          id="bulk-headless-toggle"
          data-testid="bulk-headless-toggle"
          type="checkbox"
          checked={headless}
          onChange={(event) => onHeadlessChange(event.target.checked)}
        />
        <span>Chạy ẩn</span>
      </label>
      <button
        className="bulk-run-button"
        data-testid="bulk-run-button"
        type="button"
        disabled={disabled}
        onClick={(event) => {
          ;(event.currentTarget as HTMLButtonElement).disabled = true
          onRun()
        }}
      >
        ▶ Chạy self-comment ({count})
      </button>
    </div>
  )
}
