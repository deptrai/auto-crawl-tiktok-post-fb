export interface StatusCounts {
  idle: number
  running: number
  checkpoint: number
  error: number
}

const COUNTER_ITEMS: Array<{ key: keyof StatusCounts; label: string }> = [
  { key: 'idle', label: 'Nhàn rỗi' },
  { key: 'running', label: 'Đang chạy' },
  { key: 'checkpoint', label: 'Checkpoint' },
  { key: 'error', label: 'Lỗi' }
]

export function StatusCounter({ counts }: { counts: StatusCounts }): React.JSX.Element {
  return (
    <div className="status-counter" data-testid="topbar-status-counter" aria-live="polite">
      {COUNTER_ITEMS.map((item) => (
        <span className={`status-counter-item status-counter-${item.key}`} key={item.key}>
          <span className="status-counter-dot" aria-hidden="true" />
          <span className="status-counter-label">{item.label}</span>
          <strong>{counts[item.key]}</strong>
        </span>
      ))}
    </div>
  )
}
