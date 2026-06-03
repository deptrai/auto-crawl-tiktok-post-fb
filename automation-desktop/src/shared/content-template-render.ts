export type ContentTemplateVars = { uid?: string | null; name?: string | null }

export const CONTENT_TEMPLATE_PLACEHOLDERS = ['{uid}', '{name}'] as const

// Single-pass substitution: each placeholder is resolved exactly once from the original body,
// so a substituted value containing another token (e.g. uid='a{name}b') is NOT re-substituted.
// Unknown tokens (e.g. {foo}) are left untouched. Missing/null values become empty string.
export function renderContentTemplate(body: string, vars: ContentTemplateVars): string {
  return body.replace(/\{(uid|name)\}/g, (_match, key: 'uid' | 'name') => vars[key] ?? '')
}
