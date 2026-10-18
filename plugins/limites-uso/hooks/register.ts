import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

const LABELS: Record<string, string> = {
  five_hour: 'Sesión 5h',
  seven_day: 'Semana',
  spend_limit: 'Gasto',
}

// Umbrales de % usado en los que se avisa con un toast (una vez por ventana y reinicio)
const ALERTS = [80, 95]

export function formatRemaining (resetsAt: string | undefined, now: number): string {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (!(ms > 0)) return 'reiniciando'
  const totalMin = Math.ceil(ms / 60000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const min = totalMin % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${String(min).padStart(2, '0')}m`
  return `${min}m`
}

export function formatClock (resetsAt: string, now: number): string {
  const date = new Date(resetsAt)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const sameDay = new Date(now).toDateString() === date.toDateString()
  if (sameDay) return `${hh}:${mm}`
  const days = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
  return `${days[date.getDay()]} ${hh}:${mm}`
}

function bar (percentUsed: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(percentUsed / 10)))
  return '▰'.repeat(filled) + '▱'.repeat(10 - filled)
}

export function formatLimits (limits: SessionRateLimit[], now: number): string | undefined {
  if (limits.length === 0) return undefined
  return limits
    .map(limit => {
      const label = LABELS[limit.kind] ?? limit.kind
      const left = Math.max(0, Math.round((100 - limit.percentUsed) * 10) / 10)
      const reset = limit.resetsAt
        ? ` · reinicia ${formatClock(limit.resetsAt, now)} (en ${formatRemaining(limit.resetsAt, now)})`
        : ''
      return `${label} ${bar(limit.percentUsed)} ${left}% libre${reset}`
    })
    .join('   │   ')
}

let limits: SessionRateLimit[] = []
// kind:resetsAt:umbral ya avisados, para no repetir el toast
const alerted = new Set<string>()

async function refresh ($: EngineInterface) {
  const now = await $.clock.now()
  $.ui.status(formatLimits(limits, now) ?? 'Límites de uso: esperando la primera respuesta…')
}

function checkAlerts ($: EngineInterface) {
  for (const limit of limits) {
    for (const threshold of ALERTS) {
      const key = `${limit.kind}:${limit.resetsAt ?? ''}:${threshold}`
      if (limit.percentUsed >= threshold && !alerted.has(key)) {
        alerted.add(key)
        $.ui.toast(`⚠ ${LABELS[limit.kind] ?? limit.kind}: llevas ${limit.percentUsed}% usado`, { timeoutMs: 8000 })
      }
    }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'limites',
      description: 'Muestra el uso de los límites de la suscripción y cuándo se reinician',
    })
    limits = (await $.session.usage()).rateLimits
    await refresh($)
    // La cuenta regresiva avanza aunque no haya turnos
    $.clock.every(60_000, () => { void refresh($) })
    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      limits = e.rateLimits
      checkAlerts($)
    }
    await refresh($)
    return next(e)
  })

  on('command.run', { command: 'limites' }, async $ => {
    limits = (await $.session.usage()).rateLimits
    await refresh($)
    const now = await $.clock.now()
    if (limits.length === 0) {
      return { text: 'Aún no hay datos de límites: aparecen después de la primera respuesta del modelo (solo con suscripción de claude.ai).' }
    }
    const lines = limits.map(limit => {
      const label = LABELS[limit.kind] ?? limit.kind
      const reset = limit.resetsAt
        ? `reinicia ${formatClock(limit.resetsAt, now)} (en ${formatRemaining(limit.resetsAt, now)})`
        : 'sin hora de reinicio'
      return `${label}: ${limit.percentUsed}% usado, ${Math.max(0, 100 - limit.percentUsed)}% libre — ${reset}`
    })
    return { text: lines.join('\n') }
  })
}
