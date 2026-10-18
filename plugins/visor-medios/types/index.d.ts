export type MediaKind = 'imagen' | 'video'

// Lo que ffprobe dice del archivo abierto
export type Media = {
  path: string
  name: string
  kind: MediaKind
  width: number
  height: number
  // Segundos; 0 en una imagen
  duration: number
  fps: number
  hasAudio: boolean
}

// Un archivo de la carpeta que muestra la galería
export type GalleryItem = { path: string; name: string; kind: MediaKind; size: number }

export type Gallery = { dir: string; items: GalleryItem[] }

declare module 'claude-code' {
  interface PluginState {
    'visor-medios': {
      media: Media | null
      gallery: Gallery | null
      // Texto bajo el título: "cargando…", un error
      message: string | null
      isPlaying: boolean
      isMuted: boolean
      // Segundo del video que se ve, redondeado (para la etiqueta de tiempo)
      second: number
    }
  }
}
