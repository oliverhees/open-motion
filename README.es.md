<p align="center">
  <a href="README.md">English</a> · <a href="README.de.md">Deutsch</a> · <b>Español</b> · <a href="README.fr.md">Français</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

[![Open Motion — Cada elemento es una capa.](docs/assets/open-motion-hero.jpg)](docs/assets/open-motion-hero.jpg)

# Open Motion

**El estudio de motion graphics de código abierto y autoalojado donde cada elemento es una capa editable en vivo.**

[![Licencia: AGPL v3](https://img.shields.io/badge/Licencia-AGPL--3.0-blue.svg)](LICENSE) [![Estado](https://img.shields.io/badge/Estado-Beta%200.1-orange.svg)](#-estado) [![Stack](https://img.shields.io/badge/Stack-HyperFrames%20%2B%20Web%20Animations-informational.svg)](#-arquitectura) [![Autoalojado](https://img.shields.io/badge/Autoalojado-Docker%20%2B%20Coolify-black.svg)](docs/deploy-coolify.md) [![Tests](https://img.shields.io/badge/Tests-71%20superados-brightgreen.svg)](#-estado)

*Describe tu vídeo, habla a tu facecam o arrastra archivos. La IA construye las capas, tú las ajustas en vivo y al final obtienes un MP4.*

![Showcase](docs/assets/showcase.gif)

[Inicio rápido](#-inicio-rápido) · [Funciones](#-funciones) · [Capturas](#-capturas) · [Arquitectura](#-arquitectura) · [Despliegue con Coolify](docs/deploy-coolify.md) · [Guía](docs/guide.md) · [Licencia](#-licencia)

---

## Por qué Open Motion

Los generadores de vídeo con IA te entregan píxeles terminados. Si una palabra del título está mal o un gráfico queda cinco centímetros demasiado a la izquierda, lo regeneras todo y cruzas los dedos. Los editores clásicos te dan control total, pero cada animación cuesta horas.

Open Motion toma un tercer camino: **motion graphics como código.** Cada elemento es su propia capa con marco, contenido y tiempo. La IA escribe esas capas y tú las manipulas directamente en el editor: arrastrar, escalar, escribir. El renderizado ocurre al final con Chrome sin interfaz y FFmpeg, fotograma a fotograma, exactamente como lo viste en la vista previa.

Además tienes lo que necesita un vídeo explicativo: grabación de facecam en el navegador, transcripción con tiempo por palabra, gráficos anclados a palabras habladas y corte directamente en el texto. Borra un error al hablar y la facecam, el audio y los gráficos se ajustan solos.

## 🏆 Comparativa

|  | Generadores de vídeo con IA | Editores de vídeo clásicos | Open Motion |
| --- | --- | --- | --- |
| **Cambiar un solo elemento** | ❌ normalmente regenerar todo | ✅ a mano | ✅ clic, escribir o comentario a la IA; solo cambia ese elemento |
| **Cambiar contenido, conservar el marco** | ❌ | ⚠️ tedioso | ✅ gráfico → imagen IA → vídeo; posición y animación se mantienen |
| **Facecam + transcripción + corte por texto** | ❌ | ⚠️ a menudo software extra | ✅ integrado; los gráficos cuelgan de palabras y se mueven al cortar |
| **Elegir tu modelo de IA** | ❌ el del proveedor | ❌ | ✅ tus propias claves: Claude, OpenAI, OpenRouter; imágenes con Kie.ai, OpenAI, OpenRouter, Gemini |
| **Autoalojado, tus datos se quedan contigo** | ❌ nube | ✅ local | ✅ Docker + Coolify, una carpeta por proyecto |
| **Código fuente** | ❌ | ❌ en general | ✅ AGPL-3.0 |

Para ser justos: describir animaciones como código y renderizarlas en un navegador no es una idea nueva. Lo que aportamos es todo lo que falta cuando solo renderizas: un modelo de capas que la IA **y** las personas pueden editar a la vez, un editor en vivo sin recargas, un flujo de facecam con corte por texto y un renderizado que se adapta solo a tu hardware.

## ✨ Funciones

- **Sistema de capas:** texto, formas, gráficos dibujados (SVG), imágenes, vídeo, audio. Cada capa tiene marco, keyframes, easing y transiciones de entrada y salida.
- **Editor en vivo:** clic, arrastrar, escalar, escribir directamente en la vista previa. Cambia algo en el cabezal y se crea un keyframe automáticamente. Solo se actualizan las capas modificadas; mover un vídeo nunca lo recarga.
- **Tira de escenas y ajustes:** nombre, duración y velocidad por escena, y todos los textos de la escena de un vistazo.
- **Chat de IA:** «Haz una animación de 20 segundos para mi cafetería» → escenas, textos, gráficos, imágenes. Cada respuesta se puede deshacer por separado.
- **Comentarios en elementos:** haz clic en un elemento, escribe «@IA hazlo verde» y listo. Solo cambia ese elemento.
- **Facecam:** graba en el navegador o sube un archivo, audio en su propia pista, botones de diseño (grande, esquina, círculo, dividido) con transiciones suaves.
- **Transcripción con tiempos por palabra:** local con faster-whisper o mediante OpenAI, ElevenLabs, Groq, Deepgram.
- **Anclas:** los gráficos cuelgan de palabras habladas.
- **Corte por texto:** borrar palabras corta el vídeo. Se sugieren muletillas y pausas largas; el audio recibe micro fundidos sin chasquidos al exportar.
- **Imágenes con IA:** Kie.ai, OpenAI, OpenRouter o Gemini, guardadas localmente al instante.
- **Exportación:** MP4 o GIF, 720p o 1080p, 15/30/60 fps, texto más nítido opcional.
- **Renderizado autoajustable:** detecta CPU, RAM y GPU (incluidos los límites del contenedor), planifica los workers de render y aprende de cada exportación cuánto tarda realmente.
- **Interfaz bilingüe:** inglés y alemán, intercambiables.
- **Autoalojado:** imagen Docker en variantes `slim` y `whisper`, editor y worker de render como servicios separados.

## 📸 Capturas

| Editor en vivo | Chat de IA |
| --- | --- |
| [![Editor en vivo](docs/assets/editor.png)](docs/assets/editor.png) | [![Chat de IA](docs/assets/ai-chat.png)](docs/assets/ai-chat.png) |
| **Transcripción y anclas** | **Corte por texto** |
| [![Transcripción y anclas](docs/assets/transcript-anchors.png)](docs/assets/transcript-anchors.png) | [![Corte por texto](docs/assets/text-cut.png)](docs/assets/text-cut.png) |

<sub>La captura del chat de IA muestra una conversación preparada; los cambios que menciona se aplicaron realmente al proyecto.</sub>

**Vídeo de ejemplo**, renderizado por completo desde una Motion-Spec (facecam de ejemplo, música, gráficos dibujados, una imagen anclada a la palabra hablada «image»):

![Ejemplo](docs/assets/example.gif)

## 🚀 Inicio rápido

**Con Docker (recomendado):**

```bash
git clone https://github.com/oliverhees/open-motion.git
cd open-motion
cp .env.example .env            # define OPENMOTION_PASSWORD
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env up --build
# → http://localhost:4317
```

**Sin Docker (Node 22.18+, FFmpeg):**

```bash
npm install
npx hyperframes browser ensure  # Chrome para renderizar (una vez)
npm run example:assets          # archivos de ejemplo (requiere Python + Pillow)
npm run editor:build
npm start                       # → http://localhost:4317
```

Después: ⚙ Ajustes → añade tus claves de API → 🩺 **Probar ahora**.

**En tu servidor:** [Guía de Coolify paso a paso](docs/deploy-coolify.md)

## 🧩 Arquitectura

```
Navegador (editor)                       Servidor
┌────────────────────────────┐          ┌───────────────────────────────────────────┐
│ Vista previa (composición  │  parches │ app      editor, API, login, agente IA     │
│ real en un iframe, actua-  │ ───────► │          carpetas de proyecto, chat        │
│ lizaciones en caliente)    │          │                 │ cola (archivos)          │
│ Escenario: clic, arrastrar,│          │                 ▼                          │
│ escribir, comentarios      │          │ worker   exportación (HyperFrames)         │
│ Chat IA, ajustes, medios   │          │          transcripción (Whisper / API)     │
└────────────────────────────┘          └───────────────────────────────────────────┘
```

**El núcleo** es la **Motion-Spec**, un archivo JSON con escenas y capas. El editor, la IA y el renderizador solo leen y escriben este archivo. Los cambios pasan exclusivamente por **parches** como `set`, `setAt` (keyframe automático), `swap` (cambiar contenido, conservar el marco) o `cut` (corte por texto). Cada parche se valida y los errores vuelven en lenguaje claro, para que una IA pueda corregirse sola.

**Stack:** [HyperFrames](https://github.com/heygen-com/hyperframes) (Apache 2.0) renderiza HTML a vídeo. La animación usa la **Web Animations API** del navegador, a propósito sin GSAP, cuya licencia prohíbe su uso en editores visuales de animación. Vista previa y exportación comparten exactamente las mismas funciones de easing. TypeScript se ejecuta directamente en Node 22 sin compilación; el editor es React + Vite.

Más: [Guía](docs/guide.md) · [Referencia de la Motion-Spec](docs/motion-spec.md)

## 🛡️ Seguridad

- **Editor:** inicio de sesión con contraseña (`OPENMOTION_PASSWORD`). Cookie de sesión `HttpOnly` y `SameSite=Lax`, además de `Secure` tras HTTPS. 10 intentos fallidos bloquean 15 minutos.
- **IAs y scripts:** tokens de API creados en el editor, mostrados una sola vez, **guardados solo como hash** y revocables en cualquier momento.
- **Las claves de los proveedores** se guardan con permisos 600 en el servidor y **nunca** se envían al navegador.
- **Protección CSRF:** cada cambio con cookie necesita una cabecera propia.
- **Los SVG dibujados por la IA** se sanean: se eliminan scripts, manejadores de eventos, `foreignObject` y enlaces `javascript:`.
- **Docker:** el contenedor se ejecuta sin root y la app no arranca sin contraseña.

¿Encontraste una vulnerabilidad? Consulta [SECURITY.md](SECURITY.md).

## 🔧 Estado

**Beta 0.1, respaldada por 71 tests automáticos y pruebas de extremo a extremo en Chrome sin interfaz.** Hecho: núcleo de capas, editor en vivo, grabación de facecam, transcripción local, corte por texto, agente de IA (modo de prueba y proveedores simulados), login y tokens, editor y worker separados, renderizado autoajustable. Pendiente: prueba en vivo de todas las APIs con claves reales, build de Docker confirmado en Coolify, conector MCP y Skill.

**Limitaciones conocidas:** las APIs de IA, imágenes y transcripción están construidas según la documentación y los formatos de respuesta de los proveedores; la prueba en vivo con claves reales está en curso. Las escenas completas aún no siguen los cortes por texto. Hay una sola contraseña para todos. Algunos mensajes del servidor siguen en alemán.

Detalles: [STATUS.md](STATUS.md)

## 🗺️ Hoja de ruta

1. **Conector MCP:** Claude (web, Code, Cowork), Hermes y otros agentes crean vídeos directamente en tu servidor.
2. **Skill:** reglas de diseño, chuleta de la spec y ejemplos.
3. **Escenas ancladas a palabras:** las escenas completas siguen los cortes por texto.
4. **Línea de tiempo profesional:** pistas, curvas de keyframes, pistas de audio.

## 📜 Licencia

El núcleo está bajo la **[GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE)**, una licencia de código abierto aprobada por la OSI. Libre para usar, modificar y compartir. Copyleft: si modificas Open Motion y lo ofreces como servicio en red, debes publicar también tu código modificado. **Sin GSAP.**

## 🏠 ¿No quieres autoalojarlo?

Puedes ejecutar Open Motion en tu propia infraestructura ([guía de Coolify](docs/deploy-coolify.md)). Si prefieres no montarlo tú, **podemos operar una instancia dedicada para ti.** Contacto: [aiianer.de](https://aiianer.de) o [Issues](https://github.com/oliverhees/open-motion/issues).

## 🤝 Contribuir

Issues, pull requests y debates son bienvenidos. Consulta [CONTRIBUTING.md](CONTRIBUTING.md) y nuestro [Código de conducta](CODE_OF_CONDUCT.md).

---

<p align="center">Hecho con ❤️ y pasión por <b>Oliver Hees – Der Aiianer</b> · <a href="https://aiianer.de">aiianer.de</a> · <a href="LICENSE">AGPL-3.0</a></p>
