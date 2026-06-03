export type ContentTemplateVars = { uid?: string | null; name?: string | null }

export const CONTENT_TEMPLATE_PLACEHOLDERS = ['{uid}', '{name}'] as const

export function renderContentTemplate(body: string, vars: ContentTemplateVars): string {
  return body.replaceAll('{uid}', vars.uid ?? '').replaceAll('{name}', vars.name ?? '')
}
