import { expect, test } from 'claude-code/testing'

import { cleanPath, clock, fileHref, fitSize, floatSize, fromBase64, kindOf, linkifyMedia, linkKind, mediaLinks, nameOf, packCells, parseProbe, pressable, primaryScreen, sizeLabel, toBase64, toolPath } from '../hooks/register'

test('reconoce imágenes y videos por la extensión', async () => {
  expect(kindOf('foto.PNG')).toBe('imagen')
  expect(kindOf('a/b/clip.mp4')).toBe('video')
  expect(kindOf('animada.gif')).toBe('video')
  expect(kindOf('notas.txt')).toBeNull()
  expect(kindOf('sin-extension')).toBeNull()
})

test('ajusta el tamaño a las celdas sin deformar', async () => {
  // 1920×1080 en un panel grande: se queda en vista previa de 16 filas como mucho
  const wide = fitSize(1920, 1080, 120, 40)
  expect(wide.rows).toBe(16)
  expect(wide.columns).toBe(57)
  // Una imagen vertical la limita el alto
  const tall = fitSize(1080, 1920, 120, 40)
  expect(tall.rows).toBe(16)
  expect(tall.columns).toBe(18)
  // Una panorámica, el ancho: nunca más de 64 columnas
  expect(fitSize(4000, 100, 500, 100).columns).toBe(64)
  // En un panel chico cabe en lo que hay
  expect(fitSize(1920, 1080, 30, 24).columns).toBe(30)
})

test('base64 de ida y vuelta', async () => {
  for (const bytes of [Uint8Array.of(), Uint8Array.of(1), Uint8Array.of(1, 2), Uint8Array.of(250, 0, 7, 99)]) {
    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes])
  }
  expect(toBase64(Uint8Array.of(77, 97, 110))).toBe('TWFu')
})

test('cada celda lleva el píxel de arriba como letra y el de abajo como fondo', async () => {
  // 1×2 píxeles: rojo arriba, azul abajo
  const rgb = Uint8Array.of(255, 0, 0, 0, 0, 255)
  const words = new Uint32Array(fromBase64(packCells(rgb, 0, 1, 2)).buffer)
  expect([...words]).toEqual([0x2580, 0xff0000, 0x0000ff])
})

test('lee lo que dice ffprobe', async () => {
  const video = parseProbe('/v/clip.mp4', JSON.stringify({
    streams: [
      { codec_type: 'video', width: 1280, height: 720, avg_frame_rate: '30000/1001' },
      { codec_type: 'audio' },
    ],
    format: { duration: '12.5' },
  }))
  expect(video?.kind).toBe('video')
  expect(video?.fps).toBe(15)
  expect(video?.duration).toBe(12.5)
  expect(video?.hasAudio).toBe(true)
  expect(video?.name).toBe('clip.mp4')

  const image = parseProbe('/i/foto.jpg', JSON.stringify({
    streams: [{ codec_type: 'video', width: 800, height: 600, avg_frame_rate: '0/0' }],
    format: { duration: '0.04' },
  }))
  expect(image?.kind).toBe('imagen')
  expect(image?.duration).toBe(0)

  expect(parseProbe('/x.mp3', JSON.stringify({ streams: [{ codec_type: 'audio' }] }))).toBeNull()
  expect(parseProbe('/x', 'no es json')).toBeNull()
})

test('textos de tiempo, tamaño y rutas', async () => {
  expect(clock(75)).toBe('1:15')
  expect(clock(3725)).toBe('1:02:05')
  expect(sizeLabel(2048)).toBe('2 KB')
  expect(sizeLabel(3 * 1024 * 1024)).toBe('3.0 MB')
  expect(cleanPath('"~/Videos/mi clip.mp4"', '/home/ana')).toBe('/home/ana/Videos/mi clip.mp4')
  expect(cleanPath('mi\\ foto.png', undefined)).toBe('mi foto.png')
})

test('encuentra los enlaces a imágenes y videos de una respuesta', async () => {
  const text = [
    'Mira [la foto](https://ejemplo.com/img/gato.JPG?w=800) y el clip https://cdn.x.io/v/demo.mp4.',
    'Esto no: https://ejemplo.com/docs y [repo](https://github.com/a/b).',
    'Local: file:///home/ana/captura%20final.png',
  ].join('\n')
  expect(mediaLinks(text)).toEqual([
    'https://ejemplo.com/img/gato.JPG?w=800',
    'https://cdn.x.io/v/demo.mp4',
    'file:///home/ana/captura%20final.png',
  ])
  expect(mediaLinks('sin enlaces')).toEqual([])
  expect(linkKind('https://x.com/a.webm#t=3')).toBe('video')
  expect(linkKind('mailto:a@b.png')).toBeNull()
  expect(nameOf('https://x.com/fotos/mi%20gato.png?s=1')).toBe('mi gato.png')
  expect(nameOf('/home/ana/clip.mp4')).toBe('clip.mp4')
})

test('las respuestas con enlaces a medios se dibujan con esos enlaces clicables', async ($, on) => {
  on('env.get', () => ({ value: '/home/ana' }))
  const ui = await $.ui.mount({
    plugin: 'visor-medios', surface: 'terminal', component: 'AssistantMessage',
    props: { text: 'Aquí está: https://x.com/a.png y https://x.com/docs', isFirstOfReply: true },
  })
  const node = await ui.find({ key: 'respuesta' })
  expect(node?.props.pressableLinks).toEqual(['https://x.com/a.png'])
  await ui.unmount()
})

test('la ventana flotante es chica, sin deformar y sin agrandar', async () => {
  expect(floatSize(1920, 1080)).toEqual({ width: 480, height: 270 })
  expect(floatSize(1080, 1350)).toEqual({ width: 288, height: 360 })
  expect(floatSize(200, 100)).toEqual({ width: 200, height: 100 })
})

test('encuentra la pantalla principal en xrandr', async () => {
  const xrandr = [
    'Screen 0: minimum 16 x 16, current 3840 x 1080, maximum 32767 x 32767',
    'HDMI-1 connected 1920x1080+1920+0 (normal left inverted right) 527mm x 296mm',
    'eDP-1 connected primary 1920x1080+0+0 (normal left inverted right) 344mm x 194mm',
    '   1920x1080    144.04*+',
    'DP-1 disconnected (normal left inverted right x axis y axis)',
  ].join('\n')
  expect(primaryScreen(xrandr)).toEqual({ width: 1920, height: 1080, x: 0, y: 0 })
  expect(primaryScreen('HDMI-1 connected 2560x1440+0+0 x')).toEqual({ width: 2560, height: 1440, x: 0, y: 0 })
  expect(primaryScreen('')).toBeNull()
})

test('la herramienta lee la ruta junto al evento', async () => {
  expect(toolPath({ tool: 'mcp__visor-medios__mostrar', ruta: '/tmp/clip.mp4' })).toBe('/tmp/clip.mp4')
  expect(toolPath({ tool: 'mcp__visor-medios__mostrar' })).toBe('.')
  expect(toolPath({ ruta: 3 })).toBe('.')
})

test('las rutas locales a medios se vuelven enlaces file:// clicables', async () => {
  const home = '/home/ana'
  // Entre comillas invertidas, como las devuelve el modelo: conservan el estilo de código
  expect(linkifyMedia('Imagen: `/home/ana/post/foto final.png`', home))
    .toBe('Imagen: [`/home/ana/post/foto final.png`](file:///home/ana/post/foto%20final.png)')
  // Sueltas, con ~ y con puntuación detrás
  expect(linkifyMedia('Está en ~/clips/demo.mp4. Listo', home))
    .toBe('Está en [~/clips/demo.mp4](file:///home/ana/clips/demo.mp4). Listo')
  // Un enlace markdown a una ruta simple pasa a file://
  expect(linkifyMedia('[la captura](/tmp/a#1.png)', home)).toBe('[la captura](file:///tmp/a%231.png)')
  // Lo que ya es un enlace, otros archivos, rutas relativas y bloques de código no cambian
  const same = [
    '[web](https://x.com/a.png) y file:///tmp/b.png',
    'el código en `/home/ana/app/main.ts` y `linkedin/post.png`',
    '```\ncp /tmp/a.png /tmp/b.png\n```',
  ].join('\n')
  expect(linkifyMedia(same, home)).toBe(same)
  expect(fileHref('relativa.png', home)).toBeNull()
})

test('los href clicables incluyen su forma normalizada', async () => {
  expect(pressable(['file:///tmp/a%20b.png', 'https://x.com/a.png'])).toEqual(['file:///tmp/a%20b.png', 'https://x.com/a.png'])
  expect(pressable(['https://X.com/a.png'])).toEqual(['https://X.com/a.png', 'https://x.com/a.png'])
})

test('una respuesta con una ruta entre comillas invertidas se dibuja con ella clicable', async ($, on) => {
  on('env.get', () => ({ value: '/home/ana' }))
  const ui = await $.ui.mount({
    plugin: 'visor-medios', surface: 'terminal', component: 'AssistantMessage',
    props: { text: 'Imagen: `/tmp/post-linkedin.png`', isFirstOfReply: true },
  })
  const node = await ui.find({ key: 'respuesta' })
  expect(node?.props.pressableLinks).toEqual(['file:///tmp/post-linkedin.png'])
  expect(node?.props.text).toBe('Imagen: [`/tmp/post-linkedin.png`](file:///tmp/post-linkedin.png)')
  await ui.unmount()
})
