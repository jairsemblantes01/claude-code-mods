import { expect, test } from 'claude-code/testing'

import { familyOf, isCurrent, labelFor, prettyName, priceFor, toChoices } from '../hooks/register'

test('reconoce familia y versión del id del modelo', async () => {
  expect(familyOf('claude-opus-5-5')).toBe('opus')
  expect(familyOf('sonnet')).toBe('sonnet')
  expect(familyOf(null)).toBeNull()
  expect(prettyName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(prettyName('claude-opus-5')).toBe('Opus 5')
  expect(prettyName('claude-opus-4-1-20250805')).toBe('Opus 4.1')
  expect(prettyName('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5 (1M)')
  expect(prettyName('Default (recommended)')).toBe('Default (recommended)')
})

test('nombres legibles para los alias de /config', async () => {
  expect(labelFor('opus')).toBe('Opus · último')
  expect(labelFor('opus[1m]')).toBe('Opus · 1M contexto')
  expect(labelFor('opusplan')).toBe('Opus Plan')
  expect(labelFor('claude-opus-5-5')).toBe('Opus 5.5')
})

test('alias primero y versiones de la más nueva a la más vieja', async () => {
  const list = toChoices(['default', 'claude-opus-5', 'opus', 'claude-opus-5-5', 'opus[1m]', 'opus', 'claude-sonnet-5-5'])
  const opus = list.filter(c => c.family === 'opus').map(c => c.value)
  expect(opus).toEqual(['opus', 'opus[1m]', 'claude-opus-5-5', 'claude-opus-5'])
  const current = list.find(c => c.value === 'claude-opus-5-5')!
  expect(isCurrent(current, 'claude-opus-5-5')).toBe(true)
  expect(isCurrent(list.find(c => c.value === 'claude-opus-5')!, 'claude-opus-5-5')).toBe(false)
})

test('el botón compacto abre familias, versiones y esfuerzo', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'selector-modelo', surface, component: 'AbovePrompt', props: { hasSurvey: false } })
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ key: 'effort-max' })).toBeDefined()
    expect(await ui.find({ key: 'effort-auto' })).toBeDefined()
    expect((await ui.find({ key: 'effort-auto' }))?.props.variant).toBe('primary')
    await ui.press({ key: 'effort-high' })
    expect((await ui.find({ key: 'effort-high' }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: 'effort-auto' }))?.props.variant).toBeUndefined()
    await ui.press({ key: 'effort-auto' })
    expect((await ui.find({ key: 'effort-auto' }))?.props.variant).toBe('primary')
    await ui.press({ key: 'close' })
    expect(await ui.find({ key: 'toggle' })).toBeDefined()
    await ui.unmount()
  }
})

test('precio aproximado de cada opción', async () => {
  expect(priceFor('opus')).toBe('$4/$20')
  expect(priceFor('opus[1m]')).toBe('$4/$20')
  expect(priceFor('opusplan')).toBe('$4/$20 → $2/$10')
  expect(priceFor('claude-fable-5-1')).toBe('$10/$50')
  expect(priceFor('claude-haiku-5-5')).toBe('$0.1/$0.5')
  expect(priceFor('claude-opus-4-1-20250805')).toBeUndefined()
  expect(toChoices(['sonnet'])[0]?.price).toBe('$2/$10')
})
