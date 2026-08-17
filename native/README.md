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
git tag v1.0.1 && git push origin v1.0.1
```

## Cómo se instala en el televisor

Android TV y Google TV no permiten instalar desde un archivo sin más. Lo
habitual:

1. En el televisor, Ajustes → Seguridad → permitir apps de origen desconocido.
2. Instala la app **Downloader** desde la tienda del televisor.
3. Sube el APK a tu servidor, por ejemplo a `downloads/` del propio player, y
   en Downloader escribe la dirección: `acortador.vip/player/downloads/…apk`.

Con un ordenador cerca y el televisor en modo desarrollador también sirve
`adb connect IP_DEL_TELEVISOR` y `adb install streambox-tv-….apk`.

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

## El límite que conviene saber

La app usa el WebView del sistema, así que la reproducción depende de él. En
Android TV y Google TV el WebView es Chrome y se actualiza desde la tienda, por
lo que `mpegts.js` y `hls.js` funcionan igual que en el ordenador. En Fire OS
(Fire Stick) el WebView es más antiguo y el soporte de MSE es peor: ahí la
reproducción de streams `.ts` puede fallar aunque la app se instale bien.

Si un día la reproducción por WebView se queda corta, el paso siguiente es una
app nativa con ExoPlayer, que decodifica HLS y TS por hardware. Es bastante más
trabajo y ya no reutilizaría la interfaz web.

## iOS

Un IPA instalable requiere certificado y perfil de Apple Developer, que no
están en este repositorio. Con una cuenta de pago: `npx cap add ios`,
`npx cap open ios`, Signing & Capabilities → tu Team, Product → Archive. En
`ios/App/App/Info.plist` hay que permitir HTTP con `NSAppTransportSecurity` →
`NSAllowsArbitraryLoads`.
