# StreamBox IPTV — apps nativas (Capacitor)

El reproductor es una web PHP. Las apps Android/iOS abren esa URL en un WebView (`https://masquecero.net/player/`). Cambia `server.url` en `capacitor.config.json` si el player está en otra ruta.

Paquete: `com.guchumu.playeriptv`  
Nombre: StreamBox IPTV

Este entorno no tenía Node, Android SDK ni Xcode completo, así que **no se ha generado un APK ni un IPA firmado aquí**. Hay que construirlos en una máquina con las herramientas.

## Requisitos

- Node.js 18+
- Android Studio (SDK 34+) para APK / Play Store
- Xcode + cuenta Apple Developer para IPA / App Store
- Capacitor 6 (`npm install` en esta carpeta)

## 1. Instalar y sincronizar

```bash
cd native
npm install
npx cap add android
npx cap add ios
npx cap sync
```

Copia `android-config/network_security_config.xml` a:

`android/app/src/main/res/xml/network_security_config.xml`

En `android/app/src/main/AndroidManifest.xml`:

- `android:usesCleartextTraffic="true"` en `<application>`
- `android:networkSecurityConfig="@xml/network_security_config"`
- `android:hardwareAccelerated="true"`
- permiso `INTERNET`
- orientación: `android:configChanges="orientation|screenSize|keyboardHidden"` y `android:screenOrientation="sensor"`

En iOS (`ios/App/App/Info.plist`), ATS para HTTP:

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoads</key>
  <true/>
  <key>NSAllowsArbitraryLoadsInWebContent</key>
  <true/>
</dict>
<key>UIRequiresFullScreen</key>
<true/>
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>
```

## 2. Android APK (Play Store / sideload / Fire Stick)

```bash
npx cap open android
```

En Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)** (debug) o **Generate Signed Bundle / APK** (release).

CLI, si el SDK está instalado:

```bash
cd android
./gradlew assembleDebug
# salida: android/app/build/outputs/apk/debug/app-debug.apk

./gradlew assembleRelease
# hace falta keystore para firmar
```

Fire Stick: el mismo APK se sideloadea (Apps → Manage Installed Applications, o ADB `adb install app-debug.apk`). Amazon Appstore es un flujo de publicación aparte de Google Play.

## 3. iOS IPA (App Store)

Un IPA publicable **requiere certificado y perfil de Apple Developer**. Sin eso no hay IPA de tienda.

```bash
npx cap open ios
```

En Xcode:

1. Signing & Capabilities → tu Team
2. Product → Archive
3. Distribute App → App Store Connect o Export IPA

No se puede firmar un IPA de tienda desde este repo sin esas credenciales.

## 4. HTTP / HLS

`cleartext: true` y `usesCleartextTraffic` / ATS `NSAllowsArbitraryLoads` permiten streams `http://` del servidor Xtream. En producción, HTTPS es preferible.
