#!/usr/bin/env python3
"""Ventana de vista previa de visor-medios: sin bordes, siempre encima, con un botón ✕.

Uso: preview.py <imagen|video> <ruta o URL> <ancho> <alto> <izquierda> <arriba> <título>
     <izquierda> y <arriba> pueden ser "cursor": la ventana se abre junto al puntero.

Una imagen llega ya convertida a PNG del tamaño justo (el mod la prepara con ffmpeg);
un video se reproduce con GStreamer, con sonido. Esc, q o el ✕ cierran la ventana,
arrastrarla la mueve y en un video espacio o un clic pausan.
"""
import os
import sys

os.environ.setdefault('GDK_BACKEND', 'x11')  # en Wayland solo X11 deja colocar la ventana

import gi

gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
gi.require_version('GdkPixbuf', '2.0')
from gi.repository import Gdk, GdkPixbuf, GLib, Gtk  # noqa: E402

CSS = b"""
.close {
  min-width: 26px; min-height: 26px; padding: 0; border-radius: 13px;
  background: rgba(20, 18, 15, 0.72); color: #fff; border: none; box-shadow: none;
  font-weight: bold;
}
.close:hover { background: rgba(224, 128, 90, 0.95); }
window { background: #000; }
"""


# Separación entre el puntero y la ventana, para no tapar el enlace
CURSOR_GAP = 14


def near(x, y, width, height):
    """Debajo y a la derecha del punto; si no cabe, arriba o a la izquierda, dentro de su monitor."""
    display = Gdk.Display.get_default()
    area = display.get_monitor_at_point(x, y).get_workarea()
    left = x + CURSOR_GAP if x + CURSOR_GAP + width <= area.x + area.width else x - CURSOR_GAP - width
    top = y + CURSOR_GAP if y + CURSOR_GAP + height <= area.y + area.height else y - CURSOR_GAP - height
    left = min(max(left, area.x), area.x + area.width - width)
    top = min(max(top, area.y), area.y + area.height - height)
    return left, top


def pointer(then):
    """Dónde está el puntero, aunque esté sobre una ventana de Wayland.

    X11 solo conoce el puntero mientras pasa por una de sus ventanas, así que se cubre
    la pantalla un instante con una transparente: al entrar el puntero en ella se sabe
    dónde está, se quita y se sigue con `then(x, y)`.
    """
    probe = Gtk.Window()
    probe.set_decorated(False)
    probe.set_app_paintable(True)
    visual = probe.get_screen().get_rgba_visual()
    if visual:
        probe.set_visual(visual)

    def clear(_, cr):
        cr.set_source_rgba(0, 0, 0, 0)
        cr.set_operator(1)  # SOURCE
        cr.paint()
        return True

    done = []

    def finish(x, y):
        if done:
            return False
        done.append(True)
        probe.destroy()
        then(int(x), int(y))
        return False

    def on_enter(_, event):
        return finish(event.x_root, event.y_root)

    def fallback():
        # Si no llegó el aviso de entrada, la última posición conocida
        _, x, y = Gdk.Display.get_default().get_default_seat().get_pointer().get_position()
        return finish(x, y)

    probe.add_events(Gdk.EventMask.ENTER_NOTIFY_MASK | Gdk.EventMask.POINTER_MOTION_MASK)
    probe.connect('draw', clear)
    probe.connect('enter-notify-event', on_enter)
    probe.connect('motion-notify-event', on_enter)
    probe.set_keep_above(True)
    probe.fullscreen()
    probe.show_all()
    GLib.timeout_add(400, fallback)


def main():
    kind, source, width, height, left, top, title = sys.argv[1:8]
    width, height = int(width), int(height)
    if left == 'cursor' or top == 'cursor':
        pointer(lambda x, y: build(kind, source, width, height, *near(x, y, width, height), title))
    else:
        build(kind, source, width, height, int(left), int(top), title)
    Gtk.main()


def build(kind, source, width, height, left, top, title):

    provider = Gtk.CssProvider()
    provider.load_from_data(CSS)
    Gtk.StyleContext.add_provider_for_screen(
        Gdk.Screen.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

    window = Gtk.Window(title=title)
    window.set_decorated(False)
    window.set_keep_above(True)
    window.set_skip_taskbar_hint(True)
    window.set_type_hint(Gdk.WindowTypeHint.UTILITY)
    window.set_default_size(width, height)
    window.move(left, top)

    player = None
    if kind == 'video':
        gi.require_version('Gst', '1.0')
        from gi.repository import Gst
        Gst.init(None)
        player = Gst.ElementFactory.make('playbin', None)
        sink = Gst.ElementFactory.make('gtksink', None)
        player.set_property('video-sink', sink)
        uri = source if '://' in source else Gst.filename_to_uri(source)
        player.set_property('uri', uri)
        content = sink.get_property('widget')
        bus = player.get_bus()
        bus.add_signal_watch()
        bus.connect('message::eos', lambda *_: Gtk.main_quit())
        bus.connect('message::error', lambda *_: Gtk.main_quit())
    else:
        content = Gtk.Image.new_from_pixbuf(GdkPixbuf.Pixbuf.new_from_file(source))
    content.set_size_request(width, height)

    def toggle():
        if player is None:
            return
        from gi.repository import Gst
        _, state, _ = player.get_state(0)
        player.set_state(Gst.State.PAUSED if state == Gst.State.PLAYING else Gst.State.PLAYING)

    # Arrastrar mueve la ventana; un clic sin arrastrar pausa el video
    events = Gtk.EventBox()
    events.add(content)
    pressed = {}

    def on_press(_, event):
        if event.button == 1:
            pressed['at'] = (event.x_root, event.y_root)
        return False

    def on_motion(_, event):
        start = pressed.get('at')
        if start and abs(event.x_root - start[0]) + abs(event.y_root - start[1]) > 6:
            pressed.clear()
            window.begin_move_drag(1, int(event.x_root), int(event.y_root), event.time)
        return False

    def on_release(_, event):
        if pressed.pop('at', None) is not None:
            toggle()
        return False

    events.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK
                      | Gdk.EventMask.POINTER_MOTION_MASK)
    events.connect('button-press-event', on_press)
    events.connect('motion-notify-event', on_motion)
    events.connect('button-release-event', on_release)

    close = Gtk.Button(label='✕')
    close.get_style_context().add_class('close')
    close.set_tooltip_text('Cerrar (Esc)')
    close.set_halign(Gtk.Align.END)
    close.set_valign(Gtk.Align.START)
    close.set_margin_top(6)
    close.set_margin_end(6)
    close.connect('clicked', lambda *_: Gtk.main_quit())

    overlay = Gtk.Overlay()
    overlay.add(events)
    overlay.add_overlay(close)
    window.add(overlay)

    def on_key(_, event):
        if event.keyval in (Gdk.KEY_Escape, Gdk.KEY_q):
            Gtk.main_quit()
        elif event.keyval == Gdk.KEY_space:
            toggle()
        return True

    window.connect('key-press-event', on_key)
    window.connect('destroy', lambda *_: Gtk.main_quit())
    window.show_all()
    window.move(left, top)

    if player is not None:
        from gi.repository import Gst
        player.set_state(Gst.State.PLAYING)
        window.connect('destroy', lambda *_: player.set_state(Gst.State.NULL))


if __name__ == '__main__':
    GLib.set_prgname('visor-medios')
    main()
