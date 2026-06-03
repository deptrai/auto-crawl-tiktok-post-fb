import type { LicensePublicStatus } from '../../../shared/ipc-schemas'

export type ConsoleView = 'dashboard' | 'profiles' | 'templates' | 'proxy' | 'settings'

const NAV_ITEMS: Array<{ id: ConsoleView; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'templates', label: 'Templates' },
  { id: 'proxy', label: 'Proxy' },
  { id: 'settings', label: 'Settings' }
]

function licenseText(status: LicensePublicStatus | null, offlineGrace: boolean): string {
  if (offlineGrace) return 'Offline grace'
  if (status?.active) return `License active: còn ${status.daysRemaining ?? 0} ngày`
  return 'License active'
}

export function Sidebar({
  activeView,
  licenseStatus,
  offlineGrace,
  onNavigate
}: {
  activeView: ConsoleView
  licenseStatus: LicensePublicStatus | null
  offlineGrace: boolean
  onNavigate: (view: ConsoleView) => void
}): React.JSX.Element {
  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark" aria-hidden="true" />
        <div>
          <strong>Phase 3</strong>
          <span>Automation</span>
        </div>
      </div>

      <nav className="sidebar-nav" data-testid="sidebar-nav" aria-label="Điều hướng console">
        {NAV_ITEMS.map((item) => (
          <button
            className="nav-item"
            data-testid={`nav-${item.id}`}
            type="button"
            key={item.id}
            aria-current={activeView === item.id ? 'page' : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <span className="nav-item-indicator" aria-hidden="true" />
            {item.label}
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
