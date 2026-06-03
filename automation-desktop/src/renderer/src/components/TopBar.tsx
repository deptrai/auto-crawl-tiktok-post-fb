import { StatusCounter, type StatusCounts } from './StatusCounter'

export function TopBar({
  title,
  counts
}: {
  title: string
  counts: StatusCounts
}): React.JSX.Element {
  return (
    <header className="topbar" data-testid="topbar">
      <div>
        <p className="eyebrow">Operator Console</p>
        <h1>{title}</h1>
      </div>
      <StatusCounter counts={counts} />
    </header>
  )
}
