# Sacar un APK desde el móvil

El APK que se genera aquí es una **TWA** (Trusted Web Activity): un contenedor nativo que abre tu
web a pantalla completa, sin barra de direcciones. No es una reescritura de la app, es la misma
PWA metida en un envoltorio instalable.

## Antes: el sitio tiene que estar en la raíz de un dominio

Este es el único paso que no es obvio. Para que la TWA oculte la barra de direcciones, Android
verifica un fichero en `https://TU-DOMINIO/.well-known/assetlinks.json`. En GitHub Pages con la ruta
`usuario.github.io/mlbb-roam-picker/` **no controlas la raíz**, así que la verificación falla y el
APK acaba mostrando la barra igual: pierdes la única ventaja frente a la PWA instalada.

Dos salidas, las dos desde el navegador del móvil:

- **Vercel** (más simple): entra en vercel.com, "Add New Project", importa el repo de GitHub. Te da
  `mlbb-roam-picker.vercel.app`, cuya raíz sí controlas. Cada push se republica solo.
- **GitHub Pages de usuario**: renombra el repo a `TU_USUARIO.github.io`. La app queda en la raíz,
  pero te ocupa el dominio de usuario para este proyecto.

## Generar el APK

1. Entra en `pwabuilder.com` desde Chrome.
2. Pega la URL del sitio y pulsa Start.
3. Cuando analice la PWA, elige **Android → Generate Package**.
4. Deja "Signing key: create new". Descarga el zip.

Dentro del zip vienen tres cosas: el `.apk` (para instalar tú), el `.aab` (solo si algún día subes a
Play Store) y **`signing-key-info.txt` con tu clave y su contraseña**. Guarda ese fichero donde no lo
pierdas: sin él no puedes publicar una actualización del APK, solo desinstalar y reinstalar.

## Cerrar la verificación

En el zip hay un `assetlinks.json`. Cópialo a `public/.well-known/assetlinks.json` en este repo,
haz push y espera al despliegue. Comprueba que responde abriendo
`https://TU-DOMINIO/.well-known/assetlinks.json` en el navegador: si da 404, la barra de direcciones
seguirá apareciendo en el APK.

Después instala el `.apk` (Android pedirá permiso para instalar de origen desconocido).

## ¿Compensa?

Sinceramente, poco. Android ya instala las PWA como WebAPK: icono en el cajón de aplicaciones,
pantalla completa, funciona sin conexión, y **se actualiza sola** cuando el workflow republica.

El APK añade fricción: cada cambio de la parte nativa hay que regenerarlo, firmarlo con la misma
clave y reinstalarlo a mano. Solo compensa si quieres pasárselo a alguien más por Telegram, o
subirlo a Play Store algún día.
