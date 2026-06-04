import type { LicensePublicStatus } from '../../../shared/ipc-schemas'

export type ConsoleView =
  | 'dashboard'
  | 'profiles'
  | 'templates'
  | 'messenger'
  | 'proxy'
  | 'settings'

const NAV_ITEMS: Array<{ id: ConsoleView; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'templates', label: 'Templates' },
  { id: 'messenger', label: 'Messenger' },
  { id: 'proxy', label: 'Proxy' },
  { id: 'settings', label: 'Settings' }
]

function licenseText(status: LicensePublicStatus | null, offlineGrace: boolean): string {
  if (offlineGrace) return 'Offline grace'
  if (status?.active) return `License active: còn ${status.daysRemaining ?? 0} ngày`
  if (status?.gate === 'expired-readonly') return 'Chỉ đọc'
  if (status?.gate === 'locked') return 'Đã khóa'
  return 'Chưa kích hoạt'
}

export function Sidebar({
  activeView,
  expanded,
  licenseStatus,
  offlineGrace,
  onNavigate,
  onToggleSidebar
}: {
  activeView: ConsoleView
  expanded: boolean
  licenseStatus: LicensePublicStatus | null
  offlineGrace: boolean
  onNavigate: (view: ConsoleView) => void
  onToggleSidebar: () => void
}): React.JSX.Element {
  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark" aria-hidden="true" />
        <div>
          <strong>Phase 3</strong>
          <span>Automation</span>
        </div>
        <button
          className="sidebar-toggle"
          data-testid="sidebar-toggle"
          type="button"
          aria-label="Thu gọn hoặc mở rộng sidebar"
          aria-expanded={expanded}
          onClick={onToggleSidebar}
        >
          ☰
        </button>
      </div>

      <nav className="sidebar-nav" data-testid="sidebar-nav" aria-label="Điều hướng console">
        {NAV_ITEMS.map((item) => (
          <button
            className="nav-item"
            data-testid={`nav-${item.id}`}
            type="button"
            key={item.id}
            aria-current={activeView === item.id ? 'page' : undefined}
            aria-label={item.label}
            title={item.label}
            onClick={() => onNavigate(item.id)}
          >
            <span className="nav-item-indicator" aria-hidden="true" />
            <span className="nav-item-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="license-chip" data-testid="license-chip">
        <span>License</span>
        <strong>{licenseText(licenseStatus, offlineGrace)}</strong>
      </div>
    </aside>
  )
}
