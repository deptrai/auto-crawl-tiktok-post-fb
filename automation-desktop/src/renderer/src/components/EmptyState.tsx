export interface EmptyStateAction {
  label: string
  onClick: () => void
  testId?: string
}

export interface EmptyStateProps {
  icon: string
  title: string
  description: string
  action?: EmptyStateAction
  testId?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  testId
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className="empty-state" data-testid={testId}>
      <span className="empty-state-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {action ? (
        <button
          className="secondary-button empty-state-action"
          type="button"
          data-testid={action.testId}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
