/**
 * CLI Inline Tests Runner Generation Tests
 */

import { describe, test, expect } from 'bun:test'
import { generateInlineTestsRunner } from '../../src/cli/index.js'

describe('generateInlineTestsRunner', () => {
  test('returns default path and includes scan dirs', () => {
    const result = generateInlineTestsRunner()

    expect(result.path).toBe('tests/inline-actions.test.ts')
    expect(result.content).toContain('src/actions')
    expect(result.content).toContain('src/features')
  })

  test('supports custom output and scan dirs', () => {
    const result = generateInlineTestsRunner({
      output: 'tests/custom-inline.test.ts',
      scanDirs: ['app/actions'],
    })

    expect(result.path).toBe('tests/custom-inline.test.ts')
    expect(result.content).toContain('app/actions')
  })
})
