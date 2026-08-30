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
3. Cuando termine (unos 5 minutos), hay **dos** archivos. Las URLs no cambian:

   **Android TV / Google Streamer / Fire Stick**
   **https://acortador.vip/player/downloads/tv.apk**
   Solo QR + Device ID. LibVLC en el proceso `:vlc` (el menú no se congela).

   **Android teléfono / tablet**
   **https://acortador.vip/player/downloads/android.apk**
   Formulario de lista o QR, PiP y Chromecast. ExoPlayer.

   En Downloader del Fire Stick se escribe la URL de **tv.apk**. No uses
   `streambox-tv-1.0.N.apk` ni la URL de GitHub Releases.

La primera ejecución también publica un artefacto llamado
`clave-de-firma-GUARDAR-COMO-SECRETO`. **Descárgalo y guarda su contenido** en
Settings → Secrets and variables → Actions → New repository secret, con nombre
`KEYSTORE_BASE64`. Sin eso, cada compilación firma con una clave distinta y el
televisor rechaza las actualizaciones: habría que desinstalar y volver a
instalar cada vez, perdiendo la lista guardada.

Para publicar una versión descargable, crea una etiqueta y el APK se adjunta
solo a la Release:

```bash
git tag v1.0.3 && git push origin v1.0.3
```

## Cómo se instala

1. Permitir apps de origen desconocido (Ajustes → Seguridad).
2. En Fire Stick / Google TV, instala **Downloader** y abre
   `https://acortador.vip/player/downloads/tv.apk`.
3. En el teléfono, descarga `https://acortador.vip/player/downloads/android.apk`.

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

## Reproducción

- **APK TV:** LibVLC en `VlcPlayerActivity` (proceso `:vlc`). No se carga Media3
  junto al WebView; eso congelaba Google Streamer 4K. Sin PiP ni Chromecast.
- **APK móvil:** ExoPlayer encima del WebView, PiP nativo y Chromecast de la web.
- **Navegador / PWA:** `<video>` + mpegts.js / hls.js.

`tools/patch_android_tv.py native/android tv` o `... mobile` copia plugins,
Activities y dependencias justo después de `npx cap add android`.

## iOS

El IPA lo compilan los runners macOS de GitHub (no hace falta Xcode en el Mac):

1. En el repositorio → pestaña **Actions** → flujo **IPA iOS** → **Run workflow**.
   También vale crear una etiqueta: `git tag ios-1 && git push origin ios-1`.
2. El artefacto se llama siempre **`ios.ipa`**. El flujo lo copia a
   `downloads/ios.ipa` en `main` para la URL estable
   `https://acortador.vip/player/downloads/ios.ipa`.
3. `tools/patch_ios.py` activa `NSAllowsArbitraryLoads` (streams HTTP de Xtream)
   justo después de `npx cap add ios`.

### Firma de Apple (imprescindible para instalar en un iPhone)

Sin cuenta de **Apple Developer de pago** y sin estos secretos
(Settings → Secrets and variables → Actions) el flujo genera un `ios.ipa`
**sin firmar**. Ese archivo **no se instala** en un iPhone normal: no es como el
APK de Android, que sí se sideloadea con Downloader.

Secretos:

- `IOS_CERTIFICATE_BASE64` — certificado `.p12` en base64
- `IOS_CERTIFICATE_PASSWORD` — contraseña del p12
- `IOS_PROVISION_BASE64` — perfil `.mobileprovision` en base64
- `IOS_TEAM_ID` — Team ID de la cuenta

Con esos secretos el flujo hace `xcodebuild archive` + export firmado (ad-hoc,
development o enterprise según el perfil). Para instalarlo: dispositivos
registrados en el perfil, TestFlight, o herramientas que **re-firman**
(AltStore, Sideloadly). El IPA sin firma de este repo no sustituye eso.
