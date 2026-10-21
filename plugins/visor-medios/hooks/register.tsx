import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Gallery, GalleryItem, Media, MediaKind } from '../types'

const PANE = 'visor-medios'

const media = atom({ plugin: 'visor-medios', key: 'media' } as const, null)
const gallery = atom({ plugin: 'visor-medios', key: 'gallery' } as const, null)
const message = atom({ plugin: 'visor-medios', key: 'message' } as const, null)
const isPlaying = atom({ plugin: 'visor-medios', key: 'isPlaying' } as const, false)
const isMuted = atom({ plugin: 'visor-medios', key: 'isMuted' } as const, false)
const second = atom({ plugin: 'visor-medios', key: 'second' } as const, 0)

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'ico', 'svg']
const VIDEO_EXT = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'mpg', 'mpeg', 'wmv', 'flv', '3gp', 'ogv', 'gif']

// Cuadros por segundo como máximo: más no se nota en celdas y cuesta CPU
const MAX_FPS = 15
// Tamaño máximo de la vista previa en celdas: lo justo para reconocer qué es
const MAX_COLUMNS = 64
const MAX_ROWS = 16
// Una lectura de $.fs no pasa de 4 MiB, así que el video se extrae en tramos
const CHUNK_BYTES = 3.5 * 1024 * 1024
// La ventana flotante cabe en este recuadro, en píxeles de pantalla
const FLOAT_MAX = { width: 480, height: 360 }
// Separación de la ventana con el borde de la pantalla (abajo deja sitio a la barra)
const FLOAT_MARGIN = { right: 24, bottom: 64 }
// Filas del panel que ocupan el título y los botones
const CHROME_ROWS = 4

export function kindOf (name: string): MediaKind | null {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (IMAGE_EXT.includes(ext)) return 'imagen'
  if (VIDEO_EXT.includes(ext)) return 'video'
  return null
}

const baseName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

export const isUrl = (text: string) => /^https?:\/\//i.test(text.trim())

// El nombre que se muestra: el del archivo, también al final de una URL
export function nameOf (path: string): string {
  if (!isUrl(path)) return baseName(path)
  try {
    const url = new URL(path)
    return decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? url.hostname)
  } catch {
    return path
  }
}

// Si un enlace (http, https o file) apunta a una imagen o un video, por su extensión
export function linkKind (href: string): MediaKind | null {
  try {
    const url = new URL(href)
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) return null
    return kindOf(decodeURIComponent(url.pathname))
  } catch {
    return null
  }
}

// Los enlaces a imágenes y videos de un texto markdown: [texto](url) y URLs sueltas
export function mediaLinks (text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/\]\(\s*<?([^)\s>]+)>?/g)) if (match[1]) found.add(match[1])
  for (const match of text.matchAll(/\b(?:https?|file):\/\/[^\s<>()[\]"'`]+/gi)) {
    found.add(match[0].replace(/[.,;:!?*_]+$/, ''))
  }
  return [...found].filter(href => linkKind(href) !== null).slice(0, 256)
}

const MEDIA_EXT = [...IMAGE_EXT, ...VIDEO_EXT].join('|')

// Una ruta local a una imagen o un video: absoluta o con ~/, sin saltos de línea
const isLocalMedia = (text: string) => /^(?:\/|~\/)[^\n`\]]*$/.test(text) && kindOf(text) !== null

// El file:// de una ruta local, codificado para que la URL no se corte en espacios, # o ?
export function fileHref (path: string, home: string | undefined): string | null {
  const full = cleanPath(path, home)
  if (!full.startsWith('/')) return null
  return 'file://' + encodeURI(full).replace(/[#?]/g, c => encodeURIComponent(c))
}

// Un enlace markdown, un código en línea o una ruta suelta a un medio; en ese orden para que no se pisen
const LINKIFY = new RegExp(
  '(\\[[^\\]\\n]*\\]\\([^)\\n]*\\))|`([^`\\n]+)`|' +
  `(^|[\\s>])((?:~/|/)[^\\s\`'"<>()[\\]]*\\.(?:${MEDIA_EXT}))(?=$|[\\s.,;:!?)])`,
  'gim',
)

// Las rutas locales a medios que escribe el modelo no son enlaces (Markdown solo dibuja http, https y
// file): se vuelven enlaces file:// para que un clic las abra. Los bloques de código quedan intactos.
export function linkifyMedia (text: string, home: string | undefined): string {
  return text.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/).map((part, i) => i % 2 === 1 ? part : part.replace(
    LINKIFY,
    (whole, link?: string, code?: string, lead?: string, path?: string) => {
      if (link) {
        const target = /\]\(\s*<?([^)>]*?)>?\s*\)$/.exec(link)?.[1] ?? ''
        const href = isLocalMedia(target) ? fileHref(target, home) : null
        return href ? link.slice(0, link.lastIndexOf('](')) + `](${href})` : whole
      }
      if (code) {
        const href = isLocalMedia(code.trim()) ? fileHref(code.trim(), home) : null
        return href ? `[\`${code}\`](${href})` : whole
      }
      const href = path ? fileHref(path, home) : null
      return href ? `${lead}[${path}](${href})` : whole
    },
  )).join('')
}

// Los href clicables, también como los normaliza una URL: la superficie compara con el que dibujó
export function pressable (links: string[]): string[] {
  const all = new Set<string>()
  for (const href of links) {
    all.add(href)
    try { all.add(new URL(href).href) } catch {}
  }
  return [...all].slice(0, 256)
}

// La ruta que pidió el modelo: los argumentos de la herramienta llegan junto al evento, no dentro de e.input
export function toolPath (e: object): string {
  const { ruta } = e as { ruta?: unknown }
  return typeof ruta === 'string' ? ruta : '.'
}

const dirName = (path: string) => path.slice(0, Math.max(1, path.lastIndexOf('/')))

// 75 -> "1:15"
export function clock (seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`
}

export function sizeLabel (bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Quita comillas y expande ~ de una ruta escrita a mano
export function cleanPath (text: string, home: string | undefined): string {
  let path = text.trim().replace(/^(['"])(.*)\1$/, '$2').replace(/\\ /g, ' ')
  if (home && (path === '~' || path.startsWith('~/'))) path = home + path.slice(1)
  return path
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Uint8Array.toBase64/fromBase64 cuando el entorno los tiene; si no, a mano
export function toBase64 (bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64
  if (native) return native.call(bytes)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += BASE64[(n >> 18) & 63]! + BASE64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? BASE64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? BASE64[n & 63]! : '='
  }
  return out
}

export function fromBase64 (text: string): Uint8Array {
  const native = (Uint8Array as { fromBase64?: (text: string) => Uint8Array }).fromBase64
  if (native) return native.call(Uint8Array, text)
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const n = (BASE64.indexOf(clean[i] ?? 'A') << 18) | (BASE64.indexOf(clean[i + 1] ?? 'A') << 12) |
      ((BASE64.indexOf(clean[i + 2] ?? 'A') & 63) << 6) | (BASE64.indexOf(clean[i + 3] ?? 'A') & 63)
    if (o < out.length) out[o++] = (n >> 16) & 255
    if (o < out.length) out[o++] = (n >> 8) & 255
    if (o < out.length) out[o++] = n & 255
  }
  return out
}

// Cada celda pinta dos píxeles con "▀" (arriba el color de letra, abajo el de fondo),
// y una celda es el doble de alta que de ancha, así que cada píxel queda cuadrado
export function fitSize (width: number, height: number, columns: number, rows: number) {
  const maxW = Math.max(1, Math.min(columns, MAX_COLUMNS))
  const maxH = Math.max(2, Math.min(rows, MAX_ROWS) * 2)
  const scale = Math.min(maxW / width, maxH / height)
  const pxW = Math.max(1, Math.round(width * scale))
  const pxH = Math.max(2, Math.round((height * scale) / 2) * 2)
  return { columns: pxW, rows: pxH / 2, pxW, pxH }
}

// El tamaño de la ventana flotante: la proporción del archivo dentro de FLOAT_MAX, sin agrandarlo
export function floatSize (width: number, height: number) {
  const scale = Math.min(1, FLOAT_MAX.width / width, FLOAT_MAX.height / height)
  return { width: Math.max(64, Math.round(width * scale)), height: Math.max(64, Math.round(height * scale)) }
}

// La pantalla principal en la salida de `xrandr --current`: "1920x1080+0+0"
export function primaryScreen (xrandr: string) {
  const lines = xrandr.split('\n').filter(line => / connected/.test(line))
  const line = lines.find(l => l.includes(' primary ')) ?? lines[0] ?? ''
  const match = /(\d+)x(\d+)\+(\d+)\+(\d+)/.exec(line)
  if (!match) return null
  const [, w, h, x, y] = match.map(Number)
  return { width: w ?? 0, height: h ?? 0, x: x ?? 0, y: y ?? 0 }
}

// RGB crudo (3 bytes por píxel) a las celdas de un Raster
export function packCells (rgb: Uint8Array, offset: number, pxW: number, pxH: number): string {
  const rows = pxH / 2
  const words = new Uint32Array(pxW * rows * 3)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < pxW; x++) {
      const top = offset + ((2 * y) * pxW + x) * 3
      const bottom = offset + ((2 * y + 1) * pxW + x) * 3
      const i = (y * pxW + x) * 3
      words[i] = 0x2580
      words[i + 1] = ((rgb[top] ?? 0) << 16) | ((rgb[top + 1] ?? 0) << 8) | (rgb[top + 2] ?? 0)
      words[i + 2] = ((rgb[bottom] ?? 0) << 16) | ((rgb[bottom + 1] ?? 0) << 8) | (rgb[bottom + 2] ?? 0)
    }
  }
  return toBase64(new Uint8Array(words.buffer))
}

type Probe = {
  streams?: { codec_type?: string; width?: number; height?: number; avg_frame_rate?: string; nb_frames?: string }[]
  format?: { duration?: string }
}

// La salida JSON de ffprobe a lo que el visor necesita; null si no hay imagen
export function parseProbe (path: string, json: string): Media | null {
  let probe: Probe
  try {
    probe = JSON.parse(json) as Probe
  } catch {
    return null
  }
  const video = probe.streams?.find(s => s.codec_type === 'video' && (s.width ?? 0) > 0)
  if (!video?.width || !video.height) return null
  const [num = 0, den = 1] = (video.avg_frame_rate ?? '0/1').split('/').map(Number)
  const rate = den > 0 ? num / den : 0
  const duration = Number(probe.format?.duration ?? 0) || 0
  const isStill = kindOf(path) === 'imagen' || duration <= 0 || video.nb_frames === '1'
  return {
    path,
    name: nameOf(path),
    kind: isStill ? 'imagen' : 'video',
    width: video.width,
    height: video.height,
    duration: isStill ? 0 : duration,
    fps: Math.min(MAX_FPS, rate > 0 ? rate : 10),
    hasAudio: probe.streams?.some(s => s.codec_type === 'audio') ?? false,
  }
}

// --- Lo que solo vive mientras el módulo está cargado: los píxeles y la reproducción ---

type Layout = { columns: number; rows: number; pxW: number; pxH: number }

let layout: Layout | null = null
let cells: string | null = null
// Lo que la terminal le dejó al panel la última vez que lo dibujó
let room = { columns: 0, rows: 0 }
let generation = 0
let isPreparing = false
let tmpDir: string | null = null
const chunks = new Map<number, Uint8Array>()
const loading = new Set<number>()
let ticker: Timer | null = null
let audio: AsyncIterator<unknown> | null = null
// El segundo del video que se ve y cuándo empezó a correr desde ahí
let position = 0
let startedAt = 0
let shownFrame = -1
let hasFfplay: boolean | null = null
let canFloat: boolean | null = null
// Python con GTK y GStreamer: la ventana propia, con el botón ✕ encima de la imagen
let hasGtk: boolean | null = null
let screen: { width: number; height: number; x: number; y: number } | null = null
// La ventana flotante abierta: ffplay corre mientras se lee esta salida
let floating: AsyncIterator<unknown> | null = null

async function tempDir ($: EngineInterface): Promise<string> {
  if (tmpDir) return tmpDir
  const { stdout, exitCode } = await $.process.run(['mktemp', '-d', '-t', 'visor-medios.XXXXXX'])
  if (exitCode !== 0) throw new Error('No se pudo crear la carpeta temporal')
  tmpDir = stdout.trim()
  return tmpDir
}

async function ffmpeg ($: EngineInterface, args: string[]) {
  const { exitCode, stderr } = await $.process.run(['ffmpeg', '-v', 'error', '-nostdin', '-y', ...args], { timeoutMs: 120_000 })
  if (exitCode !== 0) throw new Error(stderr.trim().split('\n').pop() || 'ffmpeg falló')
}

const scaleFilter = (l: Layout) => `scale=${l.pxW}:${l.pxH}:flags=area`

const framesPerChunk = (l: Layout) => Math.max(1, Math.floor(CHUNK_BYTES / (l.pxW * l.pxH * 3)))

async function readRaw ($: EngineInterface, file: string): Promise<Uint8Array> {
  const { base64 } = await $.fs.read(file, { as: 'bytes' })
  void $.process.run(['rm', '-f', file])
  return fromBase64(base64)
}

async function loadChunk ($: EngineInterface, item: Media, l: Layout, k: number) {
  if (chunks.has(k) || loading.has(k)) return
  const gen = generation
  loading.add(k)
  try {
    const perChunk = framesPerChunk(l)
    const from = (k * perChunk) / item.fps
    if (from >= item.duration) return
    const file = `${await tempDir($)}/g${gen}-c${k}.rgb`
    await ffmpeg($, [
      '-ss', from.toFixed(3), '-i', item.path, '-an',
      '-vf', `fps=${item.fps},${scaleFilter(l)}`,
      '-frames:v', String(perChunk), '-f', 'rawvideo', '-pix_fmt', 'rgb24', file,
    ])
    const bytes = await readRaw($, file)
    if (gen !== generation) return
    chunks.set(k, bytes)
    // Solo se guardan el tramo anterior, el actual y los siguientes
    for (const old of chunks.keys()) if (old < k - 1) chunks.delete(old)
  } finally {
    loading.delete(k)
  }
}

// Las celdas del cuadro `frame`, o null si su tramo aún no está
function frameCells (l: Layout, frame: number): string | null {
  const perChunk = framesPerChunk(l)
  const bytes = chunks.get(Math.floor(frame / perChunk))
  const size = l.pxW * l.pxH * 3
  const offset = (frame % perChunk) * size
  if (!bytes || offset + size > bytes.length) return null
  return packCells(bytes, offset, l.pxW, l.pxH)
}

// Extrae la imagen, o el cuadro actual del video, al tamaño que cabe en el panel
async function prepare ($: EngineInterface) {
  const item = await read($, media)
  if (!item || room.columns < 1 || room.rows < 1) return
  const next = fitSize(item.width, item.height, room.columns, room.rows)
  if (layout && cells && layout.columns === next.columns && layout.rows === next.rows) return
  const gen = ++generation
  chunks.clear()
  isPreparing = true
  try {
    if (item.kind === 'imagen') {
      const file = `${await tempDir($)}/g${gen}.rgb`
      await ffmpeg($, ['-i', item.path, '-frames:v', '1', '-vf', scaleFilter(next), '-f', 'rawvideo', '-pix_fmt', 'rgb24', file])
      const bytes = await readRaw($, file)
      if (gen !== generation) return
      layout = next
      cells = packCells(bytes, 0, next.pxW, next.pxH)
    } else {
      layout = next
      const frame = Math.floor(position * item.fps)
      await loadChunk($, item, next, Math.floor(frame / framesPerChunk(next)))
      if (gen !== generation) return
      cells = frameCells(next, frame) ?? cells
      shownFrame = frame
    }
    await update($, message, () => null)
  } catch (error) {
    if (gen === generation) await update($, message, () => `No se pudo mostrar: ${(error as Error).message}`)
  } finally {
    if (gen === generation) isPreparing = false
    $.ui.invalidate('ui.render')
  }
}

function stopAudio () {
  void audio?.return?.()
  audio = null
}

async function startAudio ($: EngineInterface, item: Media) {
  stopAudio()
  if (!item.hasAudio || (await read($, isMuted))) return
  if (hasFfplay === null) {
    hasFfplay = (await $.process.run(['ffplay', '-version']).catch(() => ({ exitCode: 1 }))).exitCode === 0
  }
  if (!hasFfplay) return
  const stream = $.process.spawn({
    argv: ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', '-ss', position.toFixed(2), item.path],
  })[Symbol.asyncIterator]()
  audio = stream
  void (async () => {
    try {
      while (!(await stream.next()).done) {}
    } catch {}
  })()
}

async function now ($: EngineInterface) {
  return (await $.clock.now()) / 1000
}

async function pause ($: EngineInterface) {
  if (ticker) position += (await now($)) - startedAt
  ticker?.cancel()
  ticker = null
  stopAudio()
  await update($, isPlaying, () => false)
}

async function play ($: EngineInterface) {
  const item = await read($, media)
  if (!item || item.kind !== 'video' || ticker) return
  if (position >= item.duration - 0.05) position = 0
  startedAt = await now($)
  await update($, isPlaying, () => true)
  await startAudio($, item)
  ticker = $.clock.every(Math.round(1000 / item.fps), () => void tick($, item))
}

async function tick ($: EngineInterface, item: Media) {
  const l = layout
  if (!l || isPreparing) return
  const at = position + (await now($)) - startedAt
  if (at >= item.duration) {
    await pause($)
    position = item.duration
    return
  }
  const frame = Math.floor(at * item.fps)
  const perChunk = framesPerChunk(l)
  const k = Math.floor(frame / perChunk)
  // El siguiente tramo se pide a mitad del actual para que no haya cortes
  if (frame % perChunk > perChunk / 2) void loadChunk($, item, l, k + 1).catch(() => {})
  if (frame !== shownFrame) {
    const next = frameCells(l, frame)
    if (next) {
      cells = next
      shownFrame = frame
      await $.ui.blit({ requestId: PANE, key: 'frame', cells: next })
    } else {
      void loadChunk($, item, l, k).catch(() => {})
    }
  }
  const whole = Math.floor(at)
  if (whole !== (await read($, second))) await update($, second, () => whole)
}

async function seek ($: EngineInterface, delta: number) {
  const item = await read($, media)
  if (!item || item.kind !== 'video') return
  const wasPlaying = ticker !== null
  await pause($)
  position = Math.min(Math.max(0, position + delta), Math.max(0, item.duration - 0.1))
  const l = layout
  if (l) {
    const frame = Math.floor(position * item.fps)
    await loadChunk($, item, l, Math.floor(frame / framesPerChunk(l))).catch(() => {})
    cells = frameCells(l, frame) ?? cells
    shownFrame = frame
  }
  await update($, second, () => Math.floor(position))
  $.ui.invalidate('ui.render')
  if (wasPlaying) await play($)
}

async function reset ($: EngineInterface) {
  await pause($)
  generation++
  layout = null
  cells = null
  chunks.clear()
  position = 0
  shownFrame = -1
  await update($, second, () => 0)
}

async function resolvePath ($: EngineInterface, text: string): Promise<string> {
  let path = cleanPath(text, await $.env.get('HOME'))
  // ffmpeg lee URLs directamente; un file:// es una ruta local
  if (isUrl(path)) return path
  if (path.startsWith('file://')) path = decodeURIComponent(new URL(path).pathname)
  const { exitCode, stdout } = await $.process.run(['realpath', '-e', '--', path])
  if (exitCode !== 0) throw new Error(`No existe: ${path}`)
  return stdout.trim()
}

async function listGallery ($: EngineInterface, dir: string): Promise<Gallery> {
  const entries = await $.fs.list(dir)
  const items: GalleryItem[] = []
  for (const entry of entries) {
    const kind = entry.kind === 'file' ? kindOf(entry.name) : null
    if (kind && !entry.name.startsWith('.')) {
      items.push({ path: `${dir.replace(/\/$/, '')}/${entry.name}`, name: entry.name, kind, size: entry.size })
    }
  }
  items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  return { dir, items }
}

async function probeMedia ($: EngineInterface, path: string): Promise<Media> {
  const { exitCode, stdout, stderr } = await $.process.run([
    'ffprobe', '-v', 'error', '-show_entries',
    'stream=codec_type,width,height,avg_frame_rate,nb_frames:format=duration', '-of', 'json', path,
  ])
  if (exitCode !== 0) throw new Error(stderr.trim() || 'ffprobe no pudo leer el archivo')
  const item = parseProbe(path, stdout)
  if (!item) throw new Error(`${nameOf(path)} no es una imagen ni un video`)
  return item
}

// Hay escritorio gráfico y ffplay: la vista previa va en una ventana flotante, con calidad real
async function floats ($: EngineInterface): Promise<boolean> {
  if (canFloat !== null) return canFloat
  const hasDisplay = Boolean((await $.env.get('DISPLAY')) || (await $.env.get('WAYLAND_DISPLAY')))
  const ffplay = hasDisplay && (await $.process.run(['ffplay', '-version']).catch(() => ({ exitCode: 1 }))).exitCode === 0
  canFloat = ffplay
  return canFloat
}

function closeFloating () {
  void floating?.return?.()
  floating = null
}

async function gtkWorks ($: EngineInterface): Promise<boolean> {
  if (hasGtk !== null) return hasGtk
  const check = "import gi; gi.require_version('Gtk', '3.0'); gi.require_version('Gst', '1.0'); from gi.repository import Gtk, Gst"
  hasGtk = (await $.process.run(['python3', '-c', check]).catch(() => ({ exitCode: 1 }))).exitCode === 0
  return hasGtk
}

// Una ventana sin bordes, siempre encima, con ✕ para cerrarla: junto al puntero tras un clic
// en un enlace (`atCursor`), si no en la esquina inferior derecha
async function openFloating ($: EngineInterface, item: Media, atCursor: boolean) {
  closeFloating()
  if (!screen) {
    const { stdout } = await $.process.run(['xrandr', '--current']).catch(() => ({ stdout: '' }))
    screen = primaryScreen(stdout) ?? { width: 1920, height: 1080, x: 0, y: 0 }
  }
  const size = floatSize(item.width, item.height)
  const left = screen.x + screen.width - size.width - FLOAT_MARGIN.right
  const top = screen.y + screen.height - size.height - FLOAT_MARGIN.bottom
  const title = `Vista previa · ${item.name}`
  const place = [String(size.width), String(size.height), String(Math.max(0, left)), String(Math.max(0, top))]
  let argv: string[]
  if (await gtkWorks($)) {
    let source = item.path
    // La imagen se convierte antes a un PNG del tamaño justo: así sirve cualquier formato y también una URL
    if (item.kind === 'imagen') {
      source = `${await tempDir($)}/vista-${++generation}.png`
      await ffmpeg($, ['-i', item.path, '-frames:v', '1', '-vf', `scale=${size.width}:${size.height}:flags=lanczos`, source])
    }
    const where = atCursor ? ['cursor', 'cursor'] : place.slice(2)
    argv = ['python3', `${$.plugin.root}/viewer/preview.py`, item.kind, source, ...place.slice(0, 2), ...where, title]
  } else {
    // Sin GTK queda ffplay: misma ventana, pero sin botón (Esc o q la cierran)
    argv = [
      'ffplay', '-loglevel', 'quiet', '-noborder', '-alwaysontop', '-window_title', title,
      '-x', place[0]!, '-y', place[1]!, '-left', place[2]!, '-top', place[3]!,
      ...(item.kind === 'video' ? ['-autoexit'] : []),
      item.path,
    ]
  }
  const stream = $.process.spawn({ argv })[Symbol.asyncIterator]()
  floating = stream
  void (async () => {
    try {
      while (!(await stream.next()).done) {}
    } catch {}
    if (floating === stream) floating = null
  })()
}

// Muestra un archivo: en la ventana flotante si se puede, si no en el panel
async function show ($: EngineInterface, path: string, atCursor = false): Promise<Media> {
  if (await floats($)) {
    const item = await probeMedia($, path)
    await pause($)
    await openFloating($, item, atCursor)
    return item
  }
  const item = await openFile($, path)
  if (item.kind === 'video') await play($)
  return item
}

async function openFile ($: EngineInterface, path: string) {
  const item = await probeMedia($, path)
  await reset($)
  await update($, media, () => item)
  await update($, message, () => 'Cargando…')
  // La galería de su carpeta sirve para pasar al anterior y al siguiente
  const current = await read($, gallery)
  if (isUrl(path)) {
    await update($, gallery, () => null)
  } else if (current?.dir !== dirName(path)) {
    const list = await listGallery($, dirName(path)).catch(() => null)
    await update($, gallery, () => list)
  }
  await $.ui.open({ id: PANE, title: item.name, focus: true, closeOnEscape: true, rows: MAX_ROWS + CHROME_ROWS, columns: MAX_COLUMNS + 2 })
  $.ui.invalidate('ui.render')
  return item
}

async function openGallery ($: EngineInterface, dir: string) {
  await reset($)
  const list = await listGallery($, dir)
  await update($, gallery, () => list)
  await update($, media, () => null)
  await update($, message, () => list.items.length === 0 ? 'No hay imágenes ni videos en esta carpeta' : null)
  await $.ui.open({ id: PANE, title: 'Galería', focus: true, closeOnEscape: true, rows: MAX_ROWS + CHROME_ROWS, columns: MAX_COLUMNS + 2 })
  return list
}

// Abre una ruta escrita por la persona o el modelo: un archivo, o la galería de una carpeta
async function openPath ($: EngineInterface, text: string, atCursor = false): Promise<string> {
  const path = await resolvePath($, text || '.')
  const { kind } = isUrl(path) ? { kind: 'file' } : await $.fs.stat(path)
  if (kind === 'dir') {
    const list = await openGallery($, path)
    return `Galería de ${path}: ${list.items.length} archivos`
  }
  const item = await show($, path, atCursor)
  return item.kind === 'video'
    ? `Reproduciendo ${item.name} (${clock(item.duration)}, ${item.width}×${item.height})`
    : `Mostrando ${item.name} (${item.width}×${item.height})`
}

// Un clic en un enlace a una imagen o un video lo abre directo, sin preguntar
async function openLink ($: EngineInterface, href: string) {
  try {
    await openPath($, href, true)
  } catch (error) {
    $.ui.toast(`No se pudo abrir ${nameOf(href)}: ${(error as Error).message}`)
  }
}

async function step ($: EngineInterface, delta: number) {
  const item = await read($, media)
  const list = await read($, gallery)
  if (!item || !list || list.items.length < 2) return
  const at = list.items.findIndex(i => i.path === item.path)
  const next = list.items[(at + delta + list.items.length) % list.items.length]
  if (!next) return
  try {
    await show($, next.path)
  } catch (error) {
    await update($, message, () => (error as Error).message)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'ver',
      description: 'Ve una imagen o un video aquí mismo; sin ruta, la galería de la carpeta',
      argumentHint: '[archivo o carpeta]',
    })
    await $.tool.register({
      name: 'mostrar',
      description: 'Muestra a la persona una imagen o un video (o la galería de una carpeta) en un panel de la terminal. Úsalo cuando pida ver un archivo multimedia.',
      inputSchema: {
        type: 'object',
        properties: { ruta: { type: 'string', description: 'Ruta del archivo o la carpeta' } },
        required: ['ruta'],
      },
      isDeferred: false,
    })
    return result
  })

  on('command.run', { command: 'ver' }, async ($, e) => {
    try {
      return { text: await openPath($, e.args) }
    } catch (error) {
      return { text: (error as Error).message }
    }
  })

  on('tool.call', { tool: 'mcp__visor-medios__mostrar' }, async ($, e) => {
    try {
      const text = await openPath($, toolPath(e))
      return { result: text, text }
    } catch (error) {
      return { deny: (error as Error).message }
    }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await reset($)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    ticker?.cancel()
    stopAudio()
    closeFloating()
    if (tmpDir) await $.process.run(['rm', '-rf', tmpDir]).catch(() => {})
    return next(e)
  })

  // Los enlaces a imágenes y videos de las respuestas se vuelven clicables para el visor;
  // los demás enlaces siguen abriéndose como siempre
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isSummary) return next(e)
    const text = linkifyMedia(e.props.text, await $.env.get('HOME'))
    const links = mediaLinks(text)
    if (links.length === 0) return next(e)
    const { Markdown } = $.ui.resolve(e)
    return (
      <Markdown key="respuesta" text={text} pressableLinks={pressable(links)}
        onLinkPress={link => void openLink($, link.href)} />
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>El visor solo dibuja en la terminal.</Text>
    }
    const { Box, Text, Button, Raster } = $.ui.resolve(e)
    const item = await read($, media)
    const list = await read($, gallery)
    const note = await read($, message)
    const columns = e.props.bodyColumns
    const rows = Math.max(2, e.props.scroll.bodyRows - CHROME_ROWS)

    if (!item) {
      return (
        <Box flexDirection="column">
          <Text bold>{list ? list.dir : 'Galería'}</Text>
          {note && <Text dimColor>{note}</Text>}
          {list?.items.map(one => (
            <Button key={`open-${one.path}`} plain onPress={async () => {
              try {
                await show($, one.path)
              } catch (error) {
                await update($, message, () => (error as Error).message)
              }
            }}>
              {one.kind === 'video' ? '▶ ' : '▣ '}{one.name} <Text dimColor>{sizeLabel(one.size)}</Text>
            </Button>
          ))}
        </Box>
      )
    }

    // Si cambió el espacio, se vuelve a extraer al tamaño nuevo
    if (columns !== room.columns || rows !== room.rows) {
      room = { columns, rows }
      $.clock.after(0, () => void prepare($))
    } else if (!cells && !isPreparing) {
      $.clock.after(0, () => void prepare($))
    }

    const playing = await read($, isPlaying)
    const muted = await read($, isMuted)
    const at = await read($, second)
    const many = (list?.items.length ?? 0) > 1
    const index = list ? list.items.findIndex(i => i.path === item.path) + 1 : 0
    const facts = item.kind === 'video'
      ? `${clock(at)} / ${clock(item.duration)} · ${item.width}×${item.height}`
      : `${item.width}×${item.height}`

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{item.name}</Text> <Text dimColor>{facts}{many ? ` · ${index} de ${list?.items.length}` : ''}</Text>
        </Text>
        {note && <Text dimColor>{note}</Text>}
        {layout && cells && (
          <Raster key="frame" columns={layout.columns} rows={layout.rows} cells={cells} />
        )}
        <Box flexDirection="row" gap={1}>
          {item.kind === 'video' && (
            <Button key="play" hotkey="p" variant="primary" label={playing ? 'Pausa' : 'Reproducir'}
              onPress={() => (ticker ? pause($) : play($))} />
          )}
          {item.kind === 'video' && <Button key="back" hotkey="a" label="« 5s" onPress={() => seek($, -5)} />}
          {item.kind === 'video' && <Button key="forward" hotkey="d" label="5s »" onPress={() => seek($, 5)} />}
          {item.kind === 'video' && item.hasAudio && (
            <Button key="mute" hotkey="m" label={muted ? 'Sonido: no' : 'Sonido: sí'} onPress={async () => {
              const isNowMuted = !(await read($, isMuted))
              await update($, isMuted, () => isNowMuted)
              if (isNowMuted) stopAudio()
              else if (ticker) {
                position += (await now($)) - startedAt
                startedAt = await now($)
                await startAudio($, item)
              }
            }} />
          )}
          {many && <Button key="prev" hotkey="j" label="◀ Anterior" onPress={() => step($, -1)} />}
          {many && <Button key="next" hotkey="k" label="Siguiente ▶" onPress={() => step($, 1)} />}
          {list && <Button key="gallery" hotkey="g" label="Galería" onPress={() => openGallery($, list.dir)} />}
        </Box>
      </Box>
    )
  })
}
