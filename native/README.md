# StreamBox IPTV — app para Android TV

El reproductor es una web PHP. La app es una envoltura que abre esa web
(`https://acortador.vip/player/`) a pantalla completa en el televisor, con el
icono en la pantalla de inicio y sin barra de navegador. Si mueves el player a
otra dirección, cámbiala en `capacitor.config.json` **y** en
`android-config/network_security_config.xml`.

Paquete: `com.guchumu.playeriptv` · Nombre: StreamBox IPTV

## Cómo se compila: en GitHub, no en tu ordenador

No hace falta instalar Java, Node ni Android Studio. El APK lo compilan los
servidores de GitHub, que ya traen el SDK de Android:

1. Entra en el repositorio en GitHub → pestaña **Actions**.
2. Elige el flujo **APK Android TV** → botón **Run workflow**.
3. Cuando termine (unos 5 minutos), abre la ejecución y descarga el artefacto
   `streambox-tv-1.0.N.apk`.

La primera ejecución también publica un artefacto llamado
`clave-de-firma-GUARDAR-COMO-SECRETO`. **Descárgalo y guarda su contenido** en
Settings → Secrets and variables → Actions → New repository secret, con nombre
`KEYSTORE_BASE64`. Sin eso, cada compilación firma con una clave distinta y el
televisor rechaza las actualizaciones: habría que desinstalar y volver a
instalar cada vez, perdiendo la lista guardada.

Para publicar una versión descargable, crea una etiqueta y el APK se adjunta
solo a la Release:

```bash
git tag v1.0.2 && git push origin v1.0.2
```

## Cómo se instala (Fire Stick y móvil Android)

El mismo APK sirve para Fire Stick / Android TV y para el teléfono. En el
televisor leanback es opcional, así que también aparece en el cajón del móvil.

1. Permitir apps de origen desconocido (Ajustes → Seguridad).
2. En Fire Stick, instala **Downloader** desde la tienda de Amazon.
3. En Downloader (o en el móvil, descargando el archivo) abre
   `acortador.vip/player/downloads/tv.apk`.

No hace falta Android Studio ni Java en tu ordenador: el APK lo firma GitHub
Actions. Con un PC cerca y el televisor en modo desarrollador también sirve
`adb install`.

## Qué hace que sea una app de TV y no de móvil

`npx cap add android` genera un proyecto de móvil. `tools/patch_android_tv.py`
lo adapta, y el flujo de GitHub lo ejecuta automáticamente:

- **`LEANBACK_LAUNCHER`**: sin esta categoría la app se instala pero no aparece
  en la pantalla de inicio del televisor.
- **`touchscreen` no obligatorio**: un televisor no tiene pantalla táctil y sin
  declararlo el sistema descarta la app.
- **Banner de 320×180** (`android-config/tv_banner.png`): en el lanzador de TV
  no hay texto bajo el icono, el banner es lo único que se ve. Se regenera con
  `python3 tools/make_tv_banner.py`.
- **Configuración de red**: permite streams `http://` del proveedor.

El manejo con el mando ya está en el propio reproductor (`core.js`): flechas
para moverse por canales y categorías, OK para reproducir y para pantalla
completa, atrás para salir.

Las carpetas `android/` e `ios/` no se versionan: las regenera `cap add` y las
adapta el script, así que el resultado es reproducible.

## Compilar en local, si algún día quieres

Requisitos: Node 20, JDK 17 y el SDK de Android (34+).

```bash
cd native
npm install
npx cap add android
cd .. && python3 tools/patch_android_tv.py native/android
cd native/android && ./gradlew assembleDebug
# salida: app/build/outputs/apk/debug/app-debug.apk
```

## Reproducción: ExoPlayer, no el WebView

La interfaz sigue siendo la web (categorías, QR, guía). Al elegir un canal, la
app nativa abre ExoPlayer (Media3) a pantalla completa y reproduce el mismo
`stream.php` (TS) o la URL HLS. En el navegador y en la PWA se sigue usando
`<video>` + mpegts.js.

`tools/patch_android_tv.py` copia el plugin `NativePlayer`, la Activity del
reproductor y las dependencias Media3 justo después de `npx cap add android`.

## iOS

Un IPA instalable requiere certificado y perfil de Apple Developer, que no
están en este repositorio. Con una cuenta de pago: `npx cap add ios`,
`npx cap open ios`, Signing & Capabilities → tu Team, Product → Archive. En
`ios/App/App/Info.plist` hay que permitir HTTP con `NSAppTransportSecurity` →
`NSAllowsArbitraryLoads`.
