import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Effort, ModelChoice } from '../types'

const model = atom({ plugin: 'selector-modelo', key: 'model' } as const, null)
const effort = atom({ plugin: 'selector-modelo', key: 'effort' } as const, null)
const isOpen = atom({ plugin: 'selector-modelo', key: 'isOpen' } as const, false)
const family = atom({ plugin: 'selector-modelo', key: 'family' } as const, null)
const choices = atom({ plugin: 'selector-modelo', key: 'choices' } as const, [])
// Esfuerzo que eligió la persona; null = el que decida Claude Code (auto)
const chosenEffort = atom({ plugin: 'selector-modelo', key: 'chosenEffort' } as const, null)

export const FAMILIES = [
  { alias: 'fable', label: 'Fable' },
  { alias: 'opus', label: 'Opus' },
  { alias: 'sonnet', label: 'Sonnet' },
  { alias: 'haiku', label: 'Haiku' },
] as const

// Si /config no expone la lista de modelos, al menos las versiones actuales
const FALLBACK_IDS = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']

export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

const EFFORT_LABELS: Record<Effort, string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  xhigh: 'Muy alto',
  max: 'Máximo',
}

const compact = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')

// "claude-opus-5-5" -> "opus"
export function familyOf (text: string | null): string | null {
  if (!text) return null
  const value = text.toLowerCase()
  return FAMILIES.find(f => value.includes(f.alias))?.alias ?? null
}

// "claude-opus-5-5" -> "Opus 5.5"; "claude-opus-4-1-20250805" -> "Opus 4.1"; otro texto se deja tal cual
export function prettyName (text: string): string {
  const match = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(text.trim())
  if (!match) return text
  const [, name = '', major, minor, longContext] = match
  const label = name.charAt(0).toUpperCase() + name.slice(1)
  return `${label} ${major}${minor ? `.${minor}` : ''}${longContext ? ' (1M)' : ''}`
}

// Nombre legible de una opción: un id ("Opus 5.5") o un alias de /config ("Opus · último")
export function labelFor (option: string): string {
  const value = option.trim()
  if (/^claude-/i.test(value)) return prettyName(value)
  const fam = FAMILIES.find(f => value.toLowerCase().startsWith(f.alias))
  if (!fam) return value
  const rest = value.slice(fam.alias.length).toLowerCase()
  if (rest === '') return `${fam.label} · último`
  if (rest === '[1m]') return `${fam.label} · 1M contexto`
  if (rest === 'plan') return `${fam.label} Plan`
  return value
}

// Precio de lista de la API, USD por millón de tokens [entrada, salida] (2026-10)
const PRICES: Record<string, [number, number]> = {
  'claude-fable-5-1': [10, 50],
  'claude-fable-5': [10, 50],
  'claude-opus-5-5': [4, 20],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-opus-4-7': [5, 25],
  'claude-opus-4-6': [5, 25],
  'claude-sonnet-5-5': [2, 10],
  'claude-sonnet-5': [2, 10],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-haiku-4-5': [1, 5],
}

// A qué versión apunta hoy cada alias
const LATEST: Record<string, string> = {
  fable: 'claude-fable-5-1',
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
}

const usd = (n: number) => `$${n < 1 ? n.toFixed(2).replace(/0$/, '') : n}`

function priceOf (id: string): string | undefined {
  const price = PRICES[id]
  return price ? `${usd(price[0])}/${usd(price[1])}` : undefined
}

// "opus" -> "$4/$20"; "opusplan" -> "$4/$20 → $2/$10"; ids con fecha o [1m] cuentan como su versión
export function priceFor (option: string): string | undefined {
  const value = option.trim().toLowerCase().replace(/\[1m\]$/, '').replace(/-\d{8}$/, '')
  if (value.startsWith('claude-')) return priceOf(value)
  if (value === 'opusplan') {
    const plan = priceOf(LATEST.opus ?? '')
    const run = priceOf(LATEST.sonnet ?? '')
    return plan && run ? `${plan} → ${run}` : undefined
  }
  const latest = LATEST[value]
  return latest ? priceOf(latest) : undefined
}

export function toChoices (options: readonly string[]): ModelChoice[] {
  const seen = new Set<string>()
  const list: ModelChoice[] = []
  for (const option of options) {
    const fam = familyOf(option)
    if (!fam || seen.has(option)) continue
    seen.add(option)
    list.push({ value: option, label: labelFor(option), family: fam, price: priceFor(option) })
  }
  // Alias primero, luego versiones concretas de la más nueva a la más vieja
  return list.sort((a, b) => {
    const aId = a.value.startsWith('claude-')
    const bId = b.value.startsWith('claude-')
    if (aId !== bId) return aId ? 1 : -1
    return aId ? b.value.localeCompare(a.value, undefined, { numeric: true }) : 0
  })
}

export function isCurrent (choice: ModelChoice, current: string | null): boolean {
  if (!current) return false
  const a = compact(choice.value)
  const b = compact(current)
  return a === b || compact(prettyName(choice.value)) === compact(prettyName(current))
}

async function loadChoices ($: EngineInterface) {
  let found: ModelChoice[] = []
  try {
    const row = (await $.config.list()).find(r => r.key.toLowerCase() === 'model')
    if (row?.options?.length) found = toChoices([...row.options, ...FALLBACK_IDS])
  } catch {}
  const list = found.length > 0 ? found : toChoices(FALLBACK_IDS)
  await update($, choices, () => list)
}

async function chooseModel ($: EngineInterface, choice: ModelChoice) {
  try {
    // Mismo cambio que hace el menú /config; si esa fila no lo admite, como /model <id>
    let isDone = false
    try {
      const row = (await $.config.list()).find(r => r.key.toLowerCase() === 'model')
      if (row?.options?.includes(choice.value)) {
        const { deny } = await $.config.set({ key: row.key, value: choice.value })
        isDone = deny === undefined
      }
    } catch {}
    if (!isDone) await $.command.run({ command: 'model', args: choice.value })
    await update($, model, () => choice.value)
  } catch {
    $.ui.toast(`No se pudo cambiar el modelo a ${choice.label}`)
  }
}

export function isEffort (value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORTS as string[]).includes(value)
}

// /effort <nivel> no aplica el nivel en todas las versiones ("Kept effort level as auto"),
// así que el nivel elegido se pone en cada petición del hilo principal (turn.step)
async function chooseEffort ($: EngineInterface, level: Effort | null) {
  await update($, chosenEffort, () => level)
  if (level) await update($, effort, () => level)
  try {
    await (level ? $.store.set('effort', level) : $.store.delete('effort'))
  } catch {}
  $.ui.toast(level
    ? `Esfuerzo ${EFFORT_LABELS[level]} desde la próxima respuesta`
    : 'Esfuerzo automático desde la próxima respuesta')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await loadChoices($)
    // El esfuerzo elegido se mantiene entre sesiones
    try {
      const saved = await $.store.get('effort')
      if (isEffort(saved)) {
        await update($, chosenEffort, () => saved)
        await update($, effort, () => saved)
      }
    } catch {}
    return result
  })

  // El modelo y el esfuerzo reales de cada petición del hilo principal
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const id = e.model
      await update($, model, () => id)
      // La versión en uso siempre aparece como opción
      await update($, choices, list =>
        list.some(c => c.value === id) || !familyOf(id) ? list : toChoices([...list.map(c => c.value), id]),
      )
      const wanted = await read($, chosenEffort)
      // Un modelo sin esfuerzo (e.effort ausente) se deja como está
      if (wanted && e.effort !== undefined && e.effort !== wanted) {
        await update($, effort, () => wanted)
        return yield* next({ ...e, effort: wanted })
      }
      if (isEffort(e.effort)) {
        const level = e.effort
        await update($, effort, () => level)
      }
    }
    return yield* next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, model)
    const level = await read($, effort)
    const wanted = await read($, chosenEffort)
    const open = await read($, isOpen)
    const list = await read($, choices)
    const currentFamily = familyOf(current)
    const shownFamily = (await read($, family)) ?? currentFamily
    const modelLabel = current ? prettyName(current) : '—'
    const effortLabel = (level ? EFFORT_LABELS[level] : '—') + (wanted ? '' : ' (auto)')

    if (!open) {
      return (
        <Box>
          <Button key="toggle" plain dimColor onPress={() => update($, isOpen, () => true)}>
            ⚙ {modelLabel} · esfuerzo {effortLabel} <Text dimColor>(clic para cambiar)</Text>
          </Button>
        </Box>
      )
    }

    const versions = list.filter(c => c.family === shownFamily)

    return (
      <Box flexDirection="column">
        <Box flexWrap="wrap">
          <Text dimColor>Modelo:   </Text>
          {FAMILIES.filter(f => list.some(c => c.family === f.alias)).map(f => (
            <Button
              key={`family-${f.alias}`}
              label={f.label}
              variant={f.alias === shownFamily ? 'primary' : undefined}
              dimColor={f.alias !== shownFamily}
              onPress={() => update($, family, () => f.alias)}
            />
          ))}
        </Box>
        {versions.length > 0 && (
          <Box flexWrap="wrap">
            <Text dimColor>Versión:  </Text>
            {versions.map(c => (
              <Button
                key={`model-${c.value}`}
                label={c.price ? `${c.label} ${c.price}` : c.label}
                variant={isCurrent(c, current) ? 'primary' : undefined}
                dimColor={!isCurrent(c, current)}
                onPress={() => chooseModel($, c)}
              >
                {c.label}
                {c.price && <Text dimColor> {c.price}</Text>}
              </Button>
            ))}
          </Box>
        )}
        {versions.some(c => c.price) && (
          <Text dimColor>          precio API en USD por millón de tokens: entrada/salida</Text>
        )}
        <Box flexWrap="wrap">
          <Text dimColor>Esfuerzo: </Text>
          <Button
            key="effort-auto"
            label="Auto"
            variant={wanted === null ? 'primary' : undefined}
            dimColor={wanted !== null}
            onPress={() => chooseEffort($, null)}
          />
          {EFFORTS.map(l => (
            <Button
              key={`effort-${l}`}
              label={EFFORT_LABELS[l]}
              variant={l === wanted ? 'primary' : undefined}
              dimColor={l !== wanted}
              onPress={() => chooseEffort($, l)}
            />
          ))}
          <Text> </Text>
          <Button
            key="close"
            plain
            dimColor
            label="✕ cerrar"
            onPress={async () => {
              await update($, family, () => null)
              await update($, isOpen, () => false)
            }}
          />
        </Box>
      </Box>
    )
  })
}
