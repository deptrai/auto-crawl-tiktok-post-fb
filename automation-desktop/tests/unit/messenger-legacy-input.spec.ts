import { test, expect } from '@playwright/test'
import {
  chooseLegacyContent,
  parseLegacyLines,
  removeSurrogatePairs,
  splitMessageLines
} from '../../src/main/automation/messenger-legacy-input'

test('[P0] legacy parser trims target and link lines without reordering', () => {
  expect(parseLegacyLines(' 1001 \n\n1002\n 1003 ')).toEqual(['1001', '1002', '1003'])
})

test('[P0] legacy random content splits by double star and uses injected rng', () => {
  expect(chooseLegacyContent(' one ** **two**three ', true, () => 0.5)).toBe('two')
  expect(chooseLegacyContent(' one **two ', false, () => 0.99)).toBe('one **two')
})

test('[P0] legacy multiline model removes surrogate pairs and keeps Shift+Enter line boundaries', () => {
  expect(removeSurrogatePairs('Xin😀 chào\ud83d')).toBe('Xin chào')
  expect(splitMessageLines('A😀\n\nB')).toEqual(['A', 'B'])
})
