import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'gg',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, isUnseen: true, maxRows: 10, scroll: { offset: 0, bodyRows: 10 } },
} as const

const CHATS = [
  { id: 'local_a', cliId: 'cli-a', emoji: '📈', name: 'Trading', isWorking: false, isUnseen: true, createdAt: 1 },
  { id: 'local_b', cliId: 'cli-b', emoji: '🌐', name: 'Web', isWorking: true, isUnseen: false, createdAt: 2 },
]

test('la barrita muestra un botón por chat, en desktop', async ($, on) => {
  on('clock.now', () => ({ value: 1_000 }))
  on('state.get', (_, e) => ({
    value:
      e.key === 'chats'
        ? { value: CHATS, version: 1 }
        : e.key === 'aviso'
          ? { value: null, version: 1 }
          : e.key === 'hablandoHasta'
            ? { value: 0, version: 1 }
            : { value: false, version: 1 },
  }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'local_a' })).toBeDefined()
  expect(await ui.find({ key: 'local_b' })).toBeDefined()
  await ui.unmount()
})

test('en la terminal no dibuja nada propio', async ($, on) => {
  on('clock.now', () => ({ value: 1_000 }))
  on('state.get', (_, e) => ({
    value:
      e.key === 'chats'
        ? { value: CHATS, version: 1 }
        : e.key === 'aviso'
          ? { value: null, version: 1 }
          : e.key === 'hablandoHasta'
            ? { value: 0, version: 1 }
            : { value: false, version: 1 },
  }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'local_a' })).toBeUndefined()
  await ui.unmount()
})

test('🔊 leer lee bloque por bloque desde tu último mensaje, y ⏭ salta', async ($, on) => {
  const store: Record<string, unknown> = {
    chats: CHATS, aviso: null, lector: null, isMuted: false, parpadeo: false, isHidden: false, velocidad: 1,
  }
  let version = 1
  on('clock.now', () => ({ value: 1_000 }))
  on('state.get', (_, e) => ({ value: { value: store[e.key], version } }))
  on('state.set', (_, e) => {
    store[e.key] = (e as unknown as { value: unknown }).value
    return { value: { isSet: true, version: ++version } }
  })
  on('ui.scroll', () => ({ value: {} }))
  on('session.messages', () => ({
    value: [
      { role: 'assistant', text: 'viejo', toolUses: [] },
      { role: 'user', text: 'leeme esto', toolUses: [] },
      { role: 'assistant', text: 'Primero **esto**.', toolUses: [] },
      { role: 'user', text: '', toolUses: [], toolResults: [{}] },
      { role: 'assistant', text: 'Después aquello.', toolUses: [] },
      { role: 'user', text: '<task-notification>listo</task-notification>', toolUses: [] },
      { role: 'assistant', text: 'Y al final esto.', toolUses: [] },
    ],
  }))
  const leidos: string[] = []
  on('process.run', (_, e) => {
    if (e.argv[0] === '/usr/bin/say' && e.argv[1] !== '-v' ? true : e.argv[0] === '/usr/bin/say' && e.argv[2] !== '?') leidos.push(e.argv[e.argv.length - 1])
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'leer' })
  for (let i = 0; i < 50 && store.lector !== null; i++) await new Promise(r => setTimeout(r, 5))
  expect(leidos).toEqual(['Primero esto.', 'Después aquello.', 'Y al final esto.'])
  expect(leidos.join(' ')).not.toContain('viejo')
  await ui.unmount()
})

test('si Claude todavía no escribió nada después de tu mensaje, lee la respuesta anterior', async ($, on) => {
  const store: Record<string, unknown> = {
    chats: CHATS, aviso: null, lector: null, isMuted: false, parpadeo: false, isHidden: false, velocidad: 1,
  }
  let version = 1
  on('clock.now', () => ({ value: 1_000 }))
  on('state.get', (_, e) => ({ value: { value: store[e.key], version } }))
  on('state.set', (_, e) => {
    store[e.key] = (e as unknown as { value: unknown }).value
    return { value: { isSet: true, version: ++version } }
  })
  on('ui.scroll', () => ({ value: {} }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'primera pregunta', toolUses: [] },
      { role: 'assistant', text: 'Respuesta anterior.', toolUses: [] },
      { role: 'user', text: 'segunda pregunta', toolUses: [] },
      { role: 'user', text: '[Image: source: /tmp/x.png]', toolUses: [] },
    ],
  }))
  const leidos: string[] = []
  on('process.run', (_, e) => {
    if (e.argv[0] === '/usr/bin/say' && e.argv[1] !== '-v' ? true : e.argv[0] === '/usr/bin/say' && e.argv[2] !== '?') leidos.push(e.argv[e.argv.length - 1])
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'leer' })
  for (let i = 0; i < 50 && store.lector !== null; i++) await new Promise(r => setTimeout(r, 5))
  expect(leidos).toEqual(['Respuesta anterior.'])
  await ui.unmount()
})
