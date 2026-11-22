/**
 * GG: a little cloud above the prompt of the Claude desktop app (Code tab, macOS).
 *
 * - Tabs for the chats you have open: one click switches the window to that chat.
 * - A green dot blinks on chats that are working; a soft green pill blinks on chats
 *   that finished while you were elsewhere, with a soft chime and a swinging bell.
 * - 🔊 reads aloud, block by block, everything Claude wrote since your last message,
 *   with ⏮ ⏭ to move between blocks and 1x / 1.5x / 2x speed. The block being read is
 *   outlined in the chat. It uses the voices built into macOS: no internet, no tokens.
 *
 * Optional settings in ~/.claude/gg.json (see README).
 */
import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type { Aviso, Chat, Lector } from '../types'

const chats = atom({ plugin: 'gg', key: 'chats' } as const, [] as readonly Chat[])
const isHidden = atom({ plugin: 'gg', key: 'isHidden' } as const, false)
const aviso = atom({ plugin: 'gg', key: 'aviso' } as const, null as Aviso | null)
const lector = atom({ plugin: 'gg', key: 'lector' } as const, null as Lector | null)
const isMuted = atom({ plugin: 'gg', key: 'isMuted' } as const, false)
const parpadeo = atom({ plugin: 'gg', key: 'parpadeo' } as const, false)
const velocidad = atom({ plugin: 'gg', key: 'velocidad' } as const, 1)
const voces = atom({ plugin: 'gg', key: 'voces' } as const, [] as readonly string[])
const voz = atom({ plugin: 'gg', key: 'voz' } as const, '')
const isEligiendoVoz = atom({ plugin: 'gg', key: 'isEligiendoVoz' } as const, false)

/** Most tabs shown. */
const MAX = 10
/** A chat counts as "open" if you looked at it in the last 3 hours. */
const OPEN_MS = 3 * 60 * 60 * 1000
/** How often the chat list is read again. */
const EVERY_MS = 8_000
/** The block being read carries this key, so the chat can scroll to it. */
const MARCA = 'gg-leyendo'
/** Speeds the speed button cycles through. */
const VELOCIDADES = [1, 1.5, 2]
/** macOS `say` words per minute at 1x. */
const PALABRAS_POR_MINUTO = 185

type Tema = { re: RegExp; emoji: string; name: string }

/** Default topics: a chat whose title matches gets that emoji and short name. */
const TEMAS_BASE: readonly Tema[] = [
  { re: /\bbug|error|fix|arregl/i, emoji: '🐞', name: 'Bug' },
  { re: /trading|bolsa|stock|crypto|nasdaq/i, emoji: '📈', name: 'Trading' },
  { re: /\bbot\b|agente|agent/i, emoji: '🤖', name: 'Bot' },
  { re: /\bmod\b|plugin|skill|claude/i, emoji: '🧩', name: 'Mods' },
  { re: /\bweb\b|p[aá]gina|site|frontend/i, emoji: '🌐', name: 'Web' },
  { re: /dise[nñ]o|design|logo|ui\b/i, emoji: '🎨', name: 'Diseño' },
  { re: /datos|data|sql|excel|csv/i, emoji: '📊', name: 'Datos' },
  { re: /voz|voice|audio|m[uú]sica/i, emoji: '🔊', name: 'Voz' },
  { re: /foto|imagen|image|video/i, emoji: '🖼️', name: 'Fotos' },
  { re: /test|prueba/i, emoji: '🧪', name: 'Pruebas' },
  { re: /doc|readme|texto|escrib/i, emoji: '📄', name: 'Docs' },
  { re: /c[oó]digo|code|app|script/i, emoji: '💻', name: 'Código' },
  { re: /^new session$|^nuev[oa]/i, emoji: '✨', name: 'Nuevo' },
]

/** Settings read from ~/.claude/gg.json; every field optional. */
type Ajustes = { voz: string | null; idioma: string; temas: Tema[]; kokoro: string | null }
const ajustes: Ajustes = { voz: null, idioma: 'es', temas: [], kokoro: null }

/** Kokoro voices offered when a Kokoro server is set and answering: label -> voice id. */
const VOCES_KOKORO: Record<string, string> = {
  'Kokoro · Dora (mujer)': 'ef_dora',
  'Kokoro · Alex (hombre)': 'em_alex',
  'Kokoro · Santa (hombre)': 'em_santa',
}

function describe(title: string): { emoji: string; name: string } {
  const topic = title.includes('·') ? title.split('·')[0].trim() : ''
  for (const t of [...ajustes.temas, ...TEMAS_BASE]) {
    if (t.re.test(title)) return { emoji: t.emoji, name: topic && topic.length <= 10 ? topic : t.name }
  }
  const word = (topic || title).split(/\s+/)[0] ?? ''
  return { emoji: '💬', name: word.length > 10 ? `${word.slice(0, 9)}…` : word || 'Chat' }
}

/** Strips markdown so a message reads well aloud. */
function paraLeer(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~>]+/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** To recognize a chat block by its text. */
const igual = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()

/**
 * Claude's text blocks since your last message, in order. If there are none yet
 * (Claude is just starting to answer), those of the previous answer.
 */
async function bloquesDesdeTuMensaje($: Engine): Promise<string[]> {
  const msgs = await $.session.messages()
  // Tool results, automatic notices ("<...") and the "[Image: ...]" note that comes
  // with a picture are not messages from you.
  // The app often puts automatic notes (<system-reminder>…</…>) at the start of your message:
  // they are taken out first, and what is left decides.
  const esTuyo = (i: number) => {
    const m = msgs[i]
    if (m.role !== 'user' || m.toolResults?.length) return false
    if (m.text.trim() === '') return true // a picture on its own
    const limpio = m.text.replace(/<([a-zA-Z][\w-]*)[^>]*>[\s\S]*?<\/\1>/g, '').trim()
    return limpio !== '' && !/^\[Image\b/.test(limpio)
  }
  const tuyos: number[] = []
  for (let i = 0; i < msgs.length; i++) if (esTuyo(i)) tuyos.push(i)
  const textos = (desde: number, hasta: number) =>
    msgs
      .slice(desde + 1, hasta)
      .filter(m => m.role === 'assistant' && paraLeer(m.text) !== '')
      .map(m => m.text)
  const ultimo = tuyos.length > 0 ? tuyos[tuyos.length - 1] : -1
  const ahora = textos(ultimo, msgs.length)
  if (ahora.length > 0 || tuyos.length < 2) return ahora
  return textos(tuyos[tuyos.length - 2], ultimo)
}

const sonido = ($: Engine, ...args: string[]) =>
  $.process.run(['/bin/sh', `${$.plugin.root}/bin/hablar.sh`, ...args]).catch(() => undefined)

/** The installed voices for the settings language, best first (Premium, Enhanced, then the rest). */
async function listarVoces($: Engine): Promise<string[]> {
  const r = await $.process.run(['/usr/bin/say', '-v', '?']).catch(() => null)
  if (!r) return []
  const lista = r.stdout
    .split('\n')
    .map(l => /^(.*?)\s+([a-z]{2,3}_[A-Za-z0-9]+)\s+#/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null && m[2].toLowerCase().startsWith(ajustes.idioma.toLowerCase()))
    .map(m => m[1].trim())
  const nivel = (v: string) => (/premium/i.test(v) ? 0 : /enhanced|mejorada/i.test(v) ? 1 : 2)
  const mac = [...new Set(lista)].sort((a, b) => nivel(a) - nivel(b))
  const kokoro =
    ajustes.kokoro !== null &&
    (await $.process.run(['/usr/bin/curl', '-s', '-m', '2', `${ajustes.kokoro.replace(/\/$/, '')}/estado`]).catch(() => null))
      ?.exitCode === 0
  return [...(kokoro ? Object.keys(VOCES_KOKORO) : []), ...mac]
}

/** Says `texto` with the chosen voice at the chosen speed; resolves when it is done. */
async function decir($: Engine, nombre: string, texto: string, speed: number) {
  const id = VOCES_KOKORO[nombre]
  if (id !== undefined && ajustes.kokoro !== null) {
    await $.process
      .run(['/usr/bin/python3', `${$.plugin.root}/bin/kokoro.py`, ajustes.kokoro, id, String(speed), texto], {
        timeoutMs: 600_000,
      })
      .catch(() => undefined)
    return
  }
  const rate = String(Math.round(PALABRAS_POR_MINUTO * speed))
  await $.process
    .run(['/usr/bin/say', ...(nombre ? ['-v', nombre] : []), '-r', rate, texto], { timeoutMs: 600_000 })
    .catch(() => undefined)
}

/** Saves the chosen voice in ~/.claude/gg.json, keeping the rest of the settings. */
async function guardarVoz($: Engine, nombre: string) {
  const home = await $.env.get('HOME')
  if (home === undefined) return
  const ruta = `${home}/.claude/gg.json`
  let d: Record<string, unknown> = {}
  try {
    d = JSON.parse((await $.fs.read(ruta)) as string)
  } catch {
    // no settings file yet
  }
  d.voz = nombre
  await $.fs.write(ruta, `${JSON.stringify(d, null, 2)}\n`)
}

/** Picks a voice from the list: it plays a short sample and is remembered. */
async function elegirVoz($: Engine, nombre: string) {
  await update($, voz, () => nombre)
  await update($, isEligiendoVoz, () => false)
  ajustes.voz = nombre
  await guardarVoz($, nombre).catch(() => undefined)
  await sonido($, 'callar')
  const corto = nombre.replace(/^Kokoro · /, '').replace(/\s*\(.*$/, '')
  void decir($, nombre, `Hola, soy ${corto}. Así te voy a leer.`, await read($, velocidad))
}

/** Every new reading bumps this; one left behind does not carry on by itself. */
let turno = 0

/** Reads block `i` and, if nobody touched anything, carries on with the next until the end. */
async function leerBloque($: Engine, i: number, isPress: boolean): Promise<void> {
  const actual = await read($, lector)
  if (actual === null || i < 0 || i >= actual.bloques.length) {
    await parar($)
    return
  }
  const mio = ++turno
  await sonido($, 'callar')
  await update($, lector, () => ({ bloques: actual.bloques, idx: i }))
  if (isPress) await $.ui.scroll({ to: { key: MARCA }, block: 'center' }).catch(() => undefined)
  const nombre = await read($, voz)
  const speed = await read($, velocidad)
  const id = VOCES_KOKORO[nombre]
  if (id !== undefined && ajustes.kokoro !== null) {
    // Kokoro: one process reads from block i to the end, making each next sentence while the
    // current one plays (no pause between blocks), and says which block it is on.
    const lectura = $.process.spawn({
      argv: ['/usr/bin/python3', `${$.plugin.root}/bin/kokoro.py`, ajustes.kokoro, id, String(speed), String(i)],
      input: JSON.stringify(actual.bloques.map(paraLeer)),
    })
    for await (const { text } of lectura) {
      if (mio !== turno) break
      for (const m of text.matchAll(/BLOQUE (\d+)/g)) {
        const n = Number(m[1])
        await update($, lector, l => (l === null ? l : { bloques: l.bloques, idx: n }))
      }
    }
    if (mio === turno) await parar($)
    return
  }
  await decir($, nombre, paraLeer(actual.bloques[i]), speed)
  if (mio === turno) await leerBloque($, i + 1, false)
}

async function parar($: Engine) {
  turno++
  await update($, lector, () => null)
  await sonido($, 'callar')
}

async function empezar($: Engine) {
  const bloques = await bloquesDesdeTuMensaje($)
  if (bloques.length === 0) {
    $.ui.toast('Nothing to read yet')
    return
  }
  await update($, lector, () => ({ bloques, idx: 0 }))
  void leerBloque($, 0, true)
}

async function mover($: Engine, paso: number) {
  const actual = await read($, lector)
  if (actual === null) return
  void leerBloque($, Math.max(0, Math.min(actual.bloques.length - 1, actual.idx + paso)), true)
}

/** Next speed; if reading, the current block starts again at the new speed. */
async function cambiarVelocidad($: Engine) {
  await update($, velocidad, v => VELOCIDADES[(VELOCIDADES.indexOf(v) + 1) % VELOCIDADES.length] ?? 1)
  const actual = await read($, lector)
  if (actual !== null) void leerBloque($, actual.idx, false)
}

/** Reads ~/.claude/gg.json if it exists. */
async function leerAjustes($: Engine) {
  const home = await $.env.get('HOME')
  if (home === undefined) return
  try {
    const d = JSON.parse((await $.fs.read(`${home}/.claude/gg.json`)) as string)
    ajustes.voz = typeof d.voz === 'string' ? d.voz : null
    ajustes.idioma = typeof d.idioma === 'string' ? d.idioma : 'es'
    ajustes.kokoro = typeof d.kokoro === 'string' ? d.kokoro : null
    ajustes.temas = (Array.isArray(d.temas) ? d.temas : [])
      .filter((t: { buscar?: unknown }) => typeof t.buscar === 'string')
      .map((t: { buscar: string; emoji?: string; nombre?: string }) => ({
        re: new RegExp(t.buscar, 'i'),
        emoji: t.emoji ?? '💬',
        name: t.nombre ?? '',
      }))
  } catch {
    // no settings file: defaults
  }
}

export const register: Register = on => {
  let myCliId = ''
  const mem: Memoria = { summaries: new Map(), isFirst: true }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    myCliId = await $.session.id()
    await update($, lector, () => null)
    await update($, aviso, () => null)
    await leerAjustes($)
    const lista = await listarVoces($)
    await update($, voces, () => lista)
    await update($, voz, () => ajustes.voz ?? lista[0] ?? '')
    await update($, isEligiendoVoz, () => false)
    await refresh($, myCliId, mem).catch(() => undefined)
    $.clock.every(EVERY_MS, () => refresh($, myCliId, mem).catch(() => undefined))
    $.clock.every(700, async () => {
      const list = await read($, chats)
      if (list.some(c => c.isUnseen || c.needsYou)) await update($, parpadeo, v => !v)
    })
    $.command.register({ name: 'gg', description: 'Show or hide the GG bar' })
    $.command.register({ name: 'leer', description: 'Read aloud everything Claude wrote since your last message' })
    return started
  })

  on('command.run', { command: 'leer' }, async $ => {
    await empezar($)
    return { text: 'Leyendo desde tu último mensaje.' }
  })

  on('command.run', { command: 'gg' }, async $ => {
    const hidden = await update($, isHidden, v => !v)
    return { text: hidden ? 'GG oculta. /gg para volver a verla.' : 'GG visible.' }
  })

  // The block being read gets a soft green outline in the chat.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const actual = await read($, lector)
    if (actual === null || !igual(e.props.text, actual.bloques[actual.idx] ?? '')) return next(e)
    const { Box } = $.ui.resolve(e)
    return (
      <Box key={MARCA} borderStyle="round" borderColor="#7ee2a04d" backgroundColor="#7ee2a00d" paddingX={1}>
        {await next(e)}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const list = await read($, chats)
    const now = await $.clock.now()
    const nota = await read($, aviso)
    const leyendo = await read($, lector)
    const muted = await read($, isMuted)
    const blink = await read($, parpadeo)
    const speed = await read($, velocidad)
    // For 5 s after a chat finishes, the bell swings.
    const sonando = !muted && nota !== null && now - nota.at < 5_000
    const working = list.some(c => c.isWorking && c.cliId !== myCliId)
    const color = leyendo ? '#f0883e' : sonando ? '#58a6ff' : working ? '#d2a8ff' : '#8b949e'
    // In use first (yours, working, finished unseen), with names; the rest at the end, emoji only.
    const enUso = (c: Chat) => c.cliId === myCliId || c.isWorking || c.isUnseen || c.needsYou
    const ordenados = [...list.filter(enUso), ...list.filter(c => !enUso(c))]

    const { Box, Button, Svg, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1} rowGap={0}>
        <Svg source={nube(color, leyendo ? 1.2 : 3.5)} alt="nubecita" isInteractive width={26} height={16} />
        {leyendo ? (
          <Box flexDirection="row" alignItems="center">
            <Button key="atras" plain dimColor onPress={() => mover($, -1)}>
              ⏮
            </Button>
            <Text size="caption" dimColor>
              {leyendo.idx + 1}/{leyendo.bloques.length}
            </Text>
            <Button key="adelante" plain dimColor onPress={() => mover($, 1)}>
              ⏭
            </Button>
            <Button key="parar" plain dimColor onPress={() => parar($)}>
              ⏹
            </Button>
          </Box>
        ) : (
          <Button key="leer" plain dimColor onPress={() => empezar($)}>
            🔊
          </Button>
        )}
        <Button key="velocidad" plain dimColor onPress={() => cambiarVelocidad($)}>
          {`${speed}x`}
        </Button>
        {sonando ? (
          <Svg source={campana()} alt="bell ringing" isInteractive width={18} height={18} />
        ) : (
          <Button key="silencio" plain dimColor onPress={() => update($, isMuted, v => !v)}>
            {muted ? '🔕' : '🔔'}
          </Button>
        )}
        {ordenados.map(c => {
          const isMine = c.cliId === myCliId
          // Finished unseen: a soft, see-through green pill that blinks.
          // Finished unseen: a soft green pill hugging just the button, so the app's own gray
          // hover sits exactly on it.
          const fondo = c.isUnseen
            ? {
                borderStyle: 'round',
                padding: 0,
                borderColor: blink ? '#7ee2a055' : '#7ee2a022',
                backgroundColor: blink ? '#7ee2a02e' : '#7ee2a012',
              }
            : {}
          return (
            <Box key={c.id} flexDirection="row" alignItems="center">
              {c.needsYou ? (
                <Svg source={punto(true, '#f85149')} alt="needs you" isInteractive width={8} height={8} />
              ) : isMine || c.isWorking ? (
                <Svg source={punto(c.isWorking)} alt={c.isWorking ? 'working' : 'this chat'} isInteractive width={7} height={7} />
              ) : null}
              <Box flexDirection="row" alignItems="center" {...fondo}>
              <Button
                key={c.id}
                plain
                dimColor={!isMine && !c.isUnseen && !c.needsYou}
                onPress={async () => {
                  if (isMine) return
                  // "continue" switches the window's chat without reloading it (other windows stay).
                  await $.process.run(['open', '-g', `claude://code/continue?session=${c.id}`])
                }}
              >
                {enUso(c) ? `${c.emoji} ${c.name}` : `${c.emoji}${c.name.match(/ (\d+)$/)?.[1] ?? ''}`}
              </Button>
              </Box>
              {isMine ? (
                <Button
                  key="separar"
                  plain
                  dimColor
                  onPress={async () => {
                    // Pops this chat out, then puts the new window on the half of the screen
                    // the main window is not using, full height.
                    const ventanas = `${$.plugin.root}/bin/ventanas.sh`
                    const antes = await $.process.run(['/bin/sh', ventanas, 'nombres']).catch(() => null)
                    const ok = await $.tool
                      .call({ tool: 'mcp__ccd_window__open_session_in', session_id: 'self', target: 'window' })
                      .then(() => true)
                      .catch(() => false)
                    if (!ok) {
                      $.ui.toast('Could not pop this chat out')
                      return
                    }
                    if (antes) await $.process.run(['/bin/sh', ventanas, 'acomodar', antes.stdout.trim()]).catch(() => undefined)
                  }}
                >
                  ⧉
                </Button>
              ) : null}
            </Box>
          )
        })}
      </Box>
    )
  })
}

async function popouts($: Engine, home: string): Promise<Set<string>> {
  try {
    const raw = await $.fs.read(`${home}/Library/Application Support/Claude/session-popouts.json`)
    const d = JSON.parse(raw as string)
    return new Set((d.popouts ?? []).map((p: { sessionId: string }) => p.sessionId))
  } catch {
    return new Set()
  }
}

/** What the module remembers between rounds: each chat's last summary. */
type Memoria = { summaries: Map<string, string>; isFirst: boolean }

async function refresh($: Engine, myCliId: string, mem: Memoria) {
  const home = await $.env.get('HOME')
  if (home === undefined) return
  const base = `${home}/Library/Application Support/Claude/claude-code-sessions`
  if (!(await $.fs.exists(base))) return

  // claude-code-sessions/<account>/<org>/local_*.json
  const files: { path: string; mtimeMs: number }[] = []
  for (const account of await $.fs.list(base)) {
    if (account.kind !== 'dir') continue
    for (const org of await $.fs.list(`${base}/${account.name}`)) {
      if (org.kind !== 'dir') continue
      const dir = `${base}/${account.name}/${org.name}`
      for (const f of await $.fs.list(dir)) {
        if (f.kind === 'file' && f.name.startsWith('local_') && f.name.endsWith('.json')) {
          files.push({ path: `${dir}/${f.name}`, mtimeMs: f.mtimeMs })
        }
      }
    }
  }

  const now = await $.clock.now()
  const loose = await popouts($, home)
  // Each file is ~0.5 MB: only recently touched ones and popped-out windows are read.
  const recent = files.filter(f => now - f.mtimeMs < OPEN_MS || [...loose].some(id => f.path.includes(id)))

  const found: Chat[] = []
  const finished: Chat[] = []
  let myFocus = 0
  let maxFocus = 0
  for (const f of recent) {
    try {
      const d = JSON.parse((await $.fs.read(f.path)) as string)
      if (d.isArchived) continue
      const id = String(d.sessionId)
      const cliId = String(d.cliSessionId ?? '')
      const activity = Number(d.lastActivityAt ?? 0)
      const focused = Number(d.lastFocusedAt ?? 0)
      const edge = Number(d.lastTurnEdgeAt ?? 0)
      const userAt = Number(d.latestUserFrameAt ?? 0)
      maxFocus = Math.max(maxFocus, focused)
      if (cliId === myCliId) myFocus = focused
      // The end-of-turn edge falls after your message; the start edge falls with it.
      const isEndEdge = edge - userAt > 2_000
      const isWorking =
        (!isEndEdge && now - activity < 120_000) || (activity - edge > 5_000 && now - activity < 90_000)
      const isUnseen = !isWorking && cliId !== myCliId && activity > focused && now - activity < OPEN_MS
      // Claude stopped and needs you: a question, an approval, a choice.
      const summary = d.postTurnSummary
      const needsYou =
        !isWorking &&
        !!summary &&
        (summary.status_category === 'need_input' ||
          summary.status_category === 'blocked' ||
          String(summary.needs_action ?? '').trim() !== '')
      const isOpen = loose.has(id) || cliId === myCliId || isWorking || isUnseen || needsYou || now - focused < OPEN_MS
      const chat: Chat = {
        id,
        cliId,
        ...describe(String(d.title || '')),
        isWorking,
        isUnseen: isUnseen && !needsYou,
        needsYou,
        createdAt: Number(d.createdAt ?? 0),
      }
      // The app writes a short summary each time a chat finishes: that is the signal, for free.
      const key = summary ? String(summary.summarizes_uuid ?? '') : ''
      const before = mem.summaries.get(id)
      if (key !== '') mem.summaries.set(id, key)
      if (!mem.isFirst && key !== '' && before !== key && cliId !== myCliId) finished.push(chat)
      if (isOpen) found.push(chat)
    } catch {
      // a half-written file: skipped this round
    }
  }
  mem.isFirst = false

  // Fixed order, like tabs: oldest on the left.
  found.sort((a, b) => a.createdAt - b.createdAt)
  const next = found.slice(-MAX)
  // Two of the same topic: "Web", "Web 2".
  const seen = new Map<string, number>()
  for (const c of next) {
    const n = (seen.get(c.name) ?? 0) + 1
    seen.set(c.name, n)
    if (n > 1) c.name = `${c.name} ${n}`
  }

  const before = await read($, chats)
  const same =
    before.length === next.length &&
    before.every(
      (c, i) =>
        c.id === next[i].id &&
        c.name === next[i].name &&
        c.isWorking === next[i].isWorking &&
        c.isUnseen === next[i].isUnseen &&
        c.needsYou === next[i].needsYou,
    )
  if (!same) await update($, chats, () => next)

  // Only the chat you are looking at chimes, so they don't all ring at once.
  const isLeader = myFocus > 0 && myFocus === maxFocus
  for (const chat of finished) {
    await update($, aviso, () => ({ text: `${chat.emoji} ${chat.name}`, at: now }))
    if (isLeader && !(await read($, isMuted))) await sonido($, 'tirin')
  }
}

/** The little cloud: a blob that breathes and drifts; its color says what is going on. */
function nube(color: string, segundos: number): string {
  const a = 'M8 11 C8 5 13 4 18 4 C23 4 28 5 28 11 C28 17 23 18 18 18 C13 18 8 17 8 11 Z'
  const b = 'M6 11 C7 6 12 3 18 5 C24 3 30 6 30 11 C29 16 24 19 18 17 C12 19 7 16 6 11 Z'
  const c = 'M9 11 C9 4 14 6 18 3 C22 6 27 4 27 11 C27 18 22 16 18 19 C14 16 9 18 9 11 Z'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="22" viewBox="0 0 36 22">
<g><animateTransform attributeName="transform" type="translate" values="0 0;2 -1;0 0;-2 1;0 0" dur="${segundos * 3}s" repeatCount="indefinite"/>
<path fill="${color}" opacity="0.9"><animate attributeName="d" dur="${segundos}s" repeatCount="indefinite" values="${a};${b};${c};${a}"/></path>
<circle cx="14" cy="10" r="1.2" fill="#0d1117"/><circle cx="22" cy="10" r="1.2" fill="#0d1117"/></g></svg>`
}

/** The bell swinging when a chat finishes. */
function campana(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
<text x="9" y="14" font-size="13" text-anchor="middle">🔔<animateTransform attributeName="transform" type="rotate" values="0 9 3;22 9 3;-22 9 3;16 9 3;-16 9 3;8 9 3;-8 9 3;0 9 3" dur="1s" repeatCount="indefinite"/></text></svg>`
}

/** Dot: green and steady on the chat you are in; blinking green if working; blinking red if it needs you. */
function punto(isBlinking: boolean, color = '#3fb950'): string {
  const anim = isBlinking
    ? '<animate attributeName="opacity" values="1;0.15;1" dur="1.1s" repeatCount="indefinite"/>'
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="2.6" fill="${color}">${anim}</circle></svg>`
}
