# StreamBox IPTV

Reproductor web Xtream (HLS/m3u8) con panel de administración y monitor de actividad.

## Uso

Publica esta carpeta en un PHP + MySQL (Apache/nginx).

1. Importa `api/database.sql` en MySQL (`iptv_player`).
2. Ajusta `config.php` (base de datos, `XTREAM_SERVER`, hosts permitidos, admin).
3. Abre `index.html` en el navegador.
4. Panel: `admin/login.php` — monitor: `admin_monitor.html` (hace falta sesión de admin).

`config.php` incluye credenciales locales de ejemplo; cámbialas antes de producción.

## Dispositivos

- **PC**: tres columnas (categorías / canales / vídeo).
- **Tablet**: mismas columnas, más anchas.
- **Móvil Android / iOS**: vídeo arriba, menú lateral, `100dvh` y safe-area.
- **Fire Stick / Android TV**: UI 10-foot, foco grande, mando (flechas, OK, Back, Play/Pause). El APK Android se puede sideloadear; Amazon Appstore es otro proceso.

## Apps nativas

Ver `native/README.md` (Capacitor: `com.guchumu.playeriptv`).

Hay **dos APKs**. Las URLs no cambian al publicar otra versión:

- **Android TV / Google Streamer / Fire Stick:** https://acortador.vip/player/downloads/tv.apk  
  Solo carga remota (QR o Device ID). LibVLC en un proceso aparte para no congelar el Streamer 4K.
- **Android teléfono / tablet:** https://acortador.vip/player/downloads/android.apk  
  Lista a mano o por QR, Picture-in-Picture y Chromecast. ExoPlayer.

**Navegador:** https://acortador.vip/player/ — puedes escribir usuario/clave o M3U, o cargar con QR/código.

IPA de iOS (mismo nombre siempre; sin certificado de Apple no se instala en un iPhone):

**https://acortador.vip/player/downloads/ios.ipa**

