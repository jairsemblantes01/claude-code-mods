import { expect, test } from 'claude-code/testing'

import { formatLimits, formatRemaining } from '../hooks/register'

const NOW = Date.parse('2026-10-18T10:00:00Z')

test('cuenta regresiva hasta el reinicio', async () => {
  expect(formatRemaining('2026-10-18T12:15:00Z', NOW)).toBe('2h 15m')
  expect(formatRemaining('2026-10-18T10:07:00Z', NOW)).toBe('7m')
  expect(formatRemaining('2026-10-20T13:00:00Z', NOW)).toBe('2d 3h')
  expect(formatRemaining('2026-10-18T09:00:00Z', NOW)).toBe('reiniciando')
})

test('línea de estado con uso libre y reinicio', async () => {
  const line = formatLimits([
    { kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-18T12:15:00Z' },
    { kind: 'seven_day', percentUsed: 62.5 },
  ], NOW)
  expect(line).toContain('Sesión 5h ▰▰▰▱▱▱▱▱▱▱ 70% libre')
  expect(line).toContain('(en 2h 15m)')
  expect(line).toContain('Semana')
  expect(line).toContain('37.5% libre')
  expect(formatLimits([], NOW)).toBeUndefined()
})
