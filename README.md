# claude-code-mods

Dos mods para Claude Code que hice porque me cansé de escribir comandos para cosas que quería ver de un vistazo o cambiar con un clic.

## limites-uso

Si usas Claude Code con una suscripción de claude.ai, tienes un límite que se reinicia cada 5 horas y otro semanal. Este mod los muestra debajo del prompt, con la hora del reinicio y cuánto falta:

```
Sesión 5h ▰▰▰▱▱▱▱▱▱▱ 70% libre · reinicia 16:15 (en 2h 15m)   │   Semana ▰▰▰▰▰▰▱▱▱▱ 37.5% libre · reinicia vie 09:00 (en 4d 1h)
```

La cuenta regresiva se actualiza cada minuto. Cuando pasas del 80% y del 95% de un límite te salta un aviso (uno por periodo, no cada vez que respondes). Con `/limites` ves el detalle en texto.

Ojo con dos cosas. Anthropic no da el número de tokens que te quedan, solo el porcentaje usado, así que eso es lo que muestra. Y al abrir una sesión no hay datos hasta que llega la primera respuesta del modelo. Si usas una API key en vez de suscripción, este mod no tiene nada que mostrar.

## selector-modelo

Una línea pequeña encima del prompt con el modelo y el esfuerzo que estás usando:

```
⚙ Opus 5.5 · esfuerzo Alto (clic para cambiar)
```

Al hacer clic se abre esto:

```
Modelo:   [Fable] [ Opus ] [Sonnet] [Haiku]
Versión:  [Opus · último $4/$20] [Opus · 1M contexto $4/$20] [Opus Plan $4/$20 → $2/$10] [ Opus 5.5 $4/$20 ]
          precio API en USD por millón de tokens: entrada/salida
Esfuerzo: [Auto] [Bajo] [Medio] [ Alto ] [Muy alto] [Máximo]   ✕ cerrar
```

Las versiones salen del menú `/config` de tu cuenta, así que ves las que tu plan permite. El precio al lado de cada una es el de lista de la API. Con suscripción no pagas por token, pero sirve para comparar: Fable 5.1 gasta unas dos veces y media lo que Opus 5.5, y Haiku casi nada.

Los precios los escribí a mano en `plugins/selector-modelo/hooks/register.tsx` (octubre de 2026). Si cambian, hay que actualizarlos ahí. Un modelo que el mod no conoce aparece sin precio en vez de con uno inventado.

Para que los clics funcionen en la terminal necesitas el modo de pantalla completa (`"tui": "fullscreen"` en tu `settings.json`). Sin mouse, `ctrl+x` y luego `tab` te lleva a los botones.

El esfuerzo no pasa por `/effort`. En algunas versiones ese comando responde "Kept effort level as auto" y no cambia nada, así que el mod pone el nivel que elegiste en cada petición al modelo. Se aplica desde la siguiente respuesta y se recuerda entre sesiones. Con Auto vuelves a dejar que Claude Code decida. Los subagentes siguen con su propio esfuerzo, y en un modelo que no usa niveles de esfuerzo el botón no hace nada.

## Instalación

Dentro de Claude Code, en la terminal:

```
/plugin install limites-uso --marketplace jairsemblantes01/claude-code-mods
/plugin install selector-modelo --marketplace jairsemblantes01/claude-code-mods
```

La primera vez te pregunta si quieres agregar el marketplace: responde `y` y luego elige el alcance (con Enter queda para tu usuario).

Desde la shell también funciona:

```
claude plugin install limites-uso --marketplace jairsemblantes01/claude-code-mods
claude plugin install selector-modelo --marketplace jairsemblantes01/claude-code-mods
```

En la app de escritorio no existe `/plugin`. Ahí es: el botón + junto al prompt, Plugins, Add marketplace con `jairsemblantes01/claude-code-mods`, y después Add plugin.

## Si quieres tocar el código

Cada mod está en `plugins/<nombre>/`. El código vive en `hooks/` y los tests en `tests/`. Para probar cambios sin instalar nada:

```
claude --plugin-dir plugins/selector-modelo
```

Y para validar y correr los tests:

```
claude plugin validate plugins/selector-modelo
claude plugin test plugins/selector-modelo
```
