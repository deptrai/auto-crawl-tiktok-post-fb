export type StatusPillVariant = 'idle' | 'running' | 'checkpoint' | 'error' | 'neutral'

export interface StatusPillProps {
  label: string
  variant: StatusPillVariant
  title?: string
}

export function StatusPill({ label, variant, title }: StatusPillProps): React.JSX.Element {
  return (
    <span className={`status-pill status-pill-${variant}`} title={title ?? label}>
      <span className="status-pill-dot" aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}
