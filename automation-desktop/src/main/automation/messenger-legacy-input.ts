export function parseLegacyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function removeSurrogatePairs(text: string): string {
  return text.replace(/[\uD800-\uDFFF]/g, '')
}

export function splitMessageLines(text: string): string[] {
  return parseLegacyLines(removeSurrogatePairs(text))
}

export function chooseLegacyContent(
  text: string,
  randomContent: boolean,
  rng: () => number
): string {
  if (!randomContent) return text.trim()
  const segments = text
    .split('**')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
  if (segments.length === 0) return ''
  const index = Math.min(segments.length - 1, Math.floor(rng() * segments.length))
  return segments[index]
}

export function chooseLegacyShareLink(links: string[], rng: () => number): string | undefined {
  const nonEmpty = links.map((link) => link.trim()).filter((link) => link.length > 0)
  if (nonEmpty.length === 0) return undefined
  const index = Math.min(nonEmpty.length - 1, Math.floor(rng() * nonEmpty.length))
  return nonEmpty[index]
}
