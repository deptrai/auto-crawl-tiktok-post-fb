export type ToastVariant = 'success' | 'warning' | 'error'

export interface ToastProps {
  message: string
  variant: ToastVariant
  testId?: string
  onDismiss: () => void
}

export function Toast({ message, variant, testId, onDismiss }: ToastProps): React.JSX.Element {
  return (
    <div className={`toast toast-${variant}`} data-testid={testId} role="status" aria-live="polite">
      <span>{message}</span>
      <button className="toast-close" type="button" aria-label="Đóng thông báo" onClick={onDismiss}>
        Đóng
      </button>
    </div>
  )
}
