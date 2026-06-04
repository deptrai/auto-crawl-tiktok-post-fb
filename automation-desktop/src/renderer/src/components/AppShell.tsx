import type { LicensePublicStatus } from '../../../shared/ipc-schemas'
import { useState } from 'react'
import { Sidebar, type ConsoleView } from './Sidebar'
import { TopBar } from './TopBar'
import type { StatusCounts } from './StatusCounter'

const VIEW_TITLES: Record<ConsoleView, string> = {
  dashboard: 'Dashboard',
  profiles: 'Danh sách profile',
  templates: 'Template bình luận',
  targets: 'Target Lists',
  messenger: 'Messenger seeding',
  proxy: 'Proxy provider',
  settings: 'Cài đặt'
}

export function AppShell({
  activeView,
  children,
  counts,
  licenseStatus,
  offlineGrace,
  onNavigate
}: {
  activeView: ConsoleView
  children: React.ReactNode
  counts: StatusCounts
  licenseStatus: LicensePublicStatus | null
  offlineGrace: boolean
  onNavigate: (view: ConsoleView) => void
}): React.JSX.Element {
  const [sidebarExpanded, setSidebarExpanded] = useState(false)

  return (
    <main
      className={`app-shell ${sidebarExpanded ? 'sidebar-expanded' : ''}`}
      data-testid="app-shell"
    >
      <Sidebar
        activeView={activeView}
        expanded={sidebarExpanded}
        licenseStatus={licenseStatus}
        offlineGrace={offlineGrace}
        onNavigate={onNavigate}
        onToggleSidebar={() => setSidebarExpanded((current) => !current)}
      />
      <section className="console-content" data-testid="main-shell">
        <TopBar title={VIEW_TITLES[activeView]} counts={counts} />
        {children}
      </section>
    </main>
  )
}
