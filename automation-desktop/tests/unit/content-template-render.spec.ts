import { test, expect } from '@playwright/test'
import { renderContentTemplate } from '../../src/shared/content-template-render'

test('[P0] renderContentTemplate replaces uid and name placeholders', () => {
  expect(
    renderContentTemplate('Chào {name} ({uid})', { uid: '100012345678', name: 'Nguyễn Văn A' })
  ).toBe('Chào Nguyễn Văn A (100012345678)')
})

test('[P0] renderContentTemplate replaces multiple occurrences', () => {
  expect(renderContentTemplate('{name} {name}', { name: 'Luis' })).toBe('Luis Luis')
})

test('[P0] renderContentTemplate replaces missing values with empty strings', () => {
  expect(renderContentTemplate('Chào {name} ({uid})', { uid: '100012345678' })).toBe(
    'Chào  (100012345678)'
  )
})

test('[P1] renderContentTemplate leaves unknown tokens untouched', () => {
  expect(renderContentTemplate('Chào {foo} {name}', { name: 'A' })).toBe('Chào {foo} A')
})

test('[P1] renderContentTemplate handles empty body', () => {
  expect(renderContentTemplate('', { uid: '1', name: 'A' })).toBe('')
})

test('[P1] renderContentTemplate leaves body without placeholders unchanged', () => {
  expect(renderContentTemplate('Không có placeholder', { uid: '1', name: 'A' })).toBe(
    'Không có placeholder'
  )
})

test('[P1] renderContentTemplate handles adjacent placeholders', () => {
  expect(renderContentTemplate('{uid}{name}', { uid: '1', name: 'A' })).toBe('1A')
})

test('[P1] renderContentTemplate treats null vars as empty string', () => {
  expect(renderContentTemplate('Chào {name} ({uid})', { uid: null, name: null })).toBe('Chào  ()')
})

test('[P0] renderContentTemplate does not re-substitute when a value contains another token', () => {
  // uid value literally contains "{name}" — single-pass must NOT replace it with vars.name.
  expect(renderContentTemplate('{uid}', { uid: 'a{name}b', name: 'Luis' })).toBe('a{name}b')
})
