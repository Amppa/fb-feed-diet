# FB Feed Diet - Feed limpio y sin anuncios para Facebook


[![GitHub release](https://img.shields.io/github/v/release/Amppa/fb-feed-diet)](https://github.com/Amppa/fb-feed-diet/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Español](README.es.md) | [繁體中文](README.zh-TW.md) | [English](README.md)

## 👉 Descárgalo directamente desde [release](https://github.com/Amppa/fb-feed-diet/releases)

FB Feed Diet es una extensión del navegador para Facebook que oculta publicaciones patrocinadas, contenido recomendado, Reels y anuncios de tu muro, dejando tu experiencia de lectura mucho más limpia.

Las publicaciones plegadas se sustituyen por una elegante **barra de título** que puedes desplegar cuando quieras con un solo clic, sin eliminar bloques de golpe ni romper el diseño de la página. También puedes personalizar las reglas de plegado y las preferencias de visualización según tus hábitos de lectura.

## Vista previa

<table>
  <thead>
    <tr>
      <th align="center">Antes de filtrar</th>
      <th align="center">Después de filtrar (anuncios y sugerencias)</th>
    </tr>
  </thead>
  <tbody>
    <tr valign="top">
      <td align="center" valign="top"><img src="screenshots/before.png" width="300" alt="Antes de filtrar"></td>
      <td align="center" valign="top"><img src="screenshots/after-default-2.png" width="300" alt="Después de filtrar"></td>
    </tr>
  </tbody>
</table>

## Funciones

### Modo estándar (predeterminado)

* **Bloquear anuncios (contenido patrocinado)**: pliega publicaciones patrocinadas, recomendaciones de Marketplace y anuncios de búsqueda.
* **Bloquear sugerencias (publicaciones recomendadas)**: pliega recomendaciones algorítmicas como «Sugerencias para ti».
* **Ocultar vídeos cortos (Reels e Historias)**: interruptores opcionales para plegar Reels e Historias.
* **Estadísticas en vivo**: cuenta los anuncios, las sugerencias y los vídeos que has bloqueado cada día.
* **Vista previa al pasar el cursor**: pasa el cursor por la barra de título para ver el contenido completo sin hacer clic en «Ver más».
* **Despliega y pliega en cualquier momento**: el contenido plegado se sustituye por barras de título; haz clic en cualquier punto de la barra para mostrar la publicación.

<table>
  <thead>
    <tr>
      <th align="center">Publicación normal</th>
      <th align="center">Vista previa con el cursor</th>
      <th align="center">Estado plegado</th>
    </tr>
  </thead>
  <tbody>
    <tr valign="top">
      <td align="center" valign="top"><img src="screenshots/feed-expand.png" width="300" alt="Publicación normal"></td>
      <td align="center" valign="top"><img src="screenshots/feed-titlebar-snipet.png" width="300" alt="Vista previa con el cursor"></td>
      <td align="center" valign="top"><img src="screenshots/feed-fold.png" width="300" alt="Estado plegado"></td>
    </tr>
  </tbody>
</table>

### Modo foro / índice

* **Reglas de plegado personalizadas**: ideal si prefieres leer los titulares de un vistazo y desplegar solo lo que te interese.
* **Personalización de la apariencia**: ajusta la altura de la barra de título (18px o 36px, 18px por defecto).

<img src="screenshots/after-minimize-mode2.png" height="400" alt="Modo minimizado">


## Instalación

### Google Chrome

#### Método 1: Chrome Web Store

Próximamente.

#### Método 2: descargar el paquete de release

1. Ve a la página de [Releases](https://github.com/Amppa/fb-feed-diet/releases) y descarga el último ZIP para Chrome.
2. Extrae el archivo ZIP en una carpeta local y conserva esa carpeta intacta para que el navegador pueda cargarla.
3. Abre Google Chrome y escribe `chrome://extensions/` en la barra de direcciones.
4. Activa el **Modo de desarrollador** en la esquina superior derecha.
5. Haz clic en **Cargar descomprimida**.
6. Selecciona la carpeta del proyecto extraída.
7. Abre [Facebook](https://www.facebook.com/).

Una vez cargada, la extensión estará activa en las páginas de Facebook.

### Firefox (128 o posterior)

Se puede cargar con la función de complemento temporal de Firefox:

1. Descarga o clona este repositorio.
2. Abre Firefox y escribe `about:debugging#/setup/runtime/this-firefox` en la barra de direcciones.
3. Haz clic en **Cargar complemento temporal…**.
4. Selecciona el archivo `manifest.json` del directorio del proyecto.
5. Abre [Facebook](https://www.facebook.com/).

> Nota: los complementos temporales de Firefox se descargan al reiniciar el navegador; repite el paso 3 para volver a cargarlo.

## Cómo usarlo

### Interruptor rápido

Haz clic en el icono de FB Feed Diet de la barra del navegador para activar o desactivar el filtrado al instante y ver las estadísticas actuales.

<img src="screenshots/popup.png" height="200" alt="Ventana emergente">

### Configurar los ajustes

Abre **«Opciones»** en la ventana emergente de la extensión:

* Reglas de plegado para las cinco categorías principales de publicaciones.
* Altura de la barra de título, fragmento del título, vista previa del texto al pasar el cursor y más.
* Idioma de la interfaz (English / 繁體中文 / Español) y modo de tema claro / oscuro.
* Motor de detección (**Relay** o **DOM**).

| Estadísticas y categorías en vivo | Apariencia y modo de detección |
| :---: | :---: |
| <img src="screenshots/setting1.png" height="400" alt="Estadísticas y categorías en vivo"> | <img src="screenshots/setting2.png" height="400" alt="Apariencia y modo de detección"> |

## Privacidad y permisos

FB Feed Diet está diseñado con una arquitectura de privacidad local:

* **Cero recogida de datos**: no recoge, rastrea ni transmite datos del usuario, historial de navegación ni contenido del feed. Sin telemetría, sin servidores propios y sin peticiones de red externas.
* **Almacenamiento 100% local**: todas las preferencias y estadísticas de filtrado se guardan solo en tu dispositivo (`chrome.storage.local`).
* **Permisos mínimos**:
  * Permiso de host (`*://*.facebook.com/*`): solo se usa para ejecutar la lógica de filtrado en las páginas de Facebook.
  * `storage`: guarda las preferencias y las estadísticas locales.
  * `scripting`: sincroniza los ajustes con las pestañas de Facebook que ya están abiertas.
* **Código abierto y transparente**: todo el código es abierto y verificable.
* **Política de privacidad**: para consultar los términos completos, revisa [PRIVACY.md](PRIVACY.md).

## Compatibilidad y limitaciones

* Compatible con Firefox, Google Chrome, Microsoft Edge y otros navegadores basados en Chromium.
* Facebook actualiza con frecuencia su estructura DOM, el formato de las publicaciones y sus estructuras internas de datos, lo que puede hacer que los clasificadores se quede obsoletos con el tiempo.
* Ofrece dos motores de clasificación: **Relay** (inspección directa de los datos GraphQL de Facebook) y **DOM** (exploración más amplia de la página ya renderizada).
* Si encuentras publicaciones sin clasificar o comportamientos extraños, puedes informarlos en [Issues](https://github.com/Amppa/fb-feed-diet/issues) adjuntando el registro del feed probe.

## Agradecimientos

Este proyecto se inspiró en:

* [ESUIT | ADBlocker for Facebook](https://addons.mozilla.org/es/firefox/addon/esuit-ad-blocker-for-facebook/)
* [F.B. Sponsored/Ad Post Blocker](https://github.com/browseraddons-support-wq/fb-sponsored-ad-post-blocker)

FB Feed Diet adopta rutas de clasificación distintas para asegurar una mayor precisión en la detección.

## Licencia

Este proyecto se distribuye bajo la [MIT License](LICENSE).