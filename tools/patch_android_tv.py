#!/usr/bin/env python3
"""Convierte el proyecto Android de Capacitor en una app de Android TV
con reproductor nativo: LibVLC en TV y ExoPlayer (Media3) en móvil.

`npx cap add android` genera un proyecto pensado para móvil. Para que el
televisor la acepte y la muestre en su pantalla de inicio hacen falta cuatro
cosas que Capacitor no pone:

  1. La categoría LEANBACK_LAUNCHER en el intent-filter de arranque.
  2. touchscreen declarado como no obligatorio (un televisor no tiene táctil).
  3. Un banner de 320x180, que en leanback es lo único que ve el usuario.
  4. La configuración de red que permite tráfico http a los orígenes IPTV.

Además se inyecta el reproductor nativo. En Google TV Streamer (MediaTek)
ExoPlayer congela el vídeo y el audio sigue; por eso en leanback se usa
LibVLC, pero nunca encima del WebView (eso abortaba el proceso al mover el
mando). En TV el canal abre VlcPlayerActivity en el proceso :vlc. En el
teléfono sigue ExoPlayer encima del WebView.

El WebView de Android TV usa un User-Agent de Chrome de móvil, sin "TV".
StreamBoxPlugin detecta leanback / UI_MODE_TYPE_TELEVISION e inyecta
window.StreamBoxNative = { isTv, hasExo, hasVlc, engine } antes de core.js.

Se edita el XML con ElementTree en vez de con expresiones regulares porque el
manifest de Capacitor cambia de forma entre versiones. Es idempotente: se puede
ejecutar varias veces sin duplicar nada.

Uso: python3 tools/patch_android_tv.py [ruta/al/proyecto/android]
"""

import re
import shutil
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CONFIG = RAIZ / "native" / "android-config"
EXO = CONFIG / "exoplayer"
ANDROID = "http://schemas.android.com/apk/res/android"
A = f"{{{ANDROID}}}"

MEDIA3 = "1.4.1"
LIBVLC = "3.6.0"
DEPS_PLAYER = [
    f'    implementation "androidx.media3:media3-exoplayer:{MEDIA3}"',
    f'    implementation "androidx.media3:media3-exoplayer-hls:{MEDIA3}"',
    f'    implementation "androidx.media3:media3-ui:{MEDIA3}"',
    f'    implementation "org.videolan.android:libvlc-all:{LIBVLC}"',
    '    implementation "androidx.webkit:webkit:1.9.0"',
]

CARACTERISTICAS_OPCIONALES = [
    "android.hardware.touchscreen",
    "android.software.leanback",
    "android.hardware.location.gps",
    "android.hardware.camera",
    "android.hardware.microphone",
]

PERMISOS = [
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.WAKE_LOCK",
]

ATRIBUTOS_APP = {
    "banner": "@drawable/tv_banner",
    "isGame": "false",
    "hardwareAccelerated": "true",
    "usesCleartextTraffic": "true",
    "networkSecurityConfig": "@xml/network_security_config",
}

JAVA_PLUGINS = (
    "NativePlayerPlugin.java",
    "TvPlayerPlugin.java",
    "PlayerActivity.java",
    "VlcPlayerActivity.java",
    "VlcOptions.java",
    "StreamBoxPlugin.java",
)


def indentar(elem, nivel=0):
    """Deja el XML legible: ElementTree no formatea al escribir."""
    hueco = "\n" + "    " * nivel
    if len(elem):
        if not (elem.text or "").strip():
            elem.text = hueco + "    "
        for hijo in elem:
            indentar(hijo, nivel + 1)
        if not (elem[-1].tail or "").strip():
            elem[-1].tail = hueco
    if nivel and not (elem.tail or "").strip():
        elem.tail = hueco


def asegurar_actividad(app, nombre_corto, cambios, extras=None):
    extras = extras or {}
    for act in app.findall("activity"):
        nombre = act.get(f"{A}name") or ""
        if nombre.endswith(nombre_corto):
            for clave, valor in extras.items():
                if act.get(clave) != valor:
                    act.set(clave, valor)
                    cambios.append(f"activity {nombre_corto} {clave}")
            return
    attrs = {
        f"{A}name": "." + nombre_corto,
        f"{A}configChanges": "keyboard|keyboardHidden|orientation|screenSize|smallestScreenSize|screenLayout|uiMode",
        f"{A}exported": "false",
        f"{A}hardwareAccelerated": "true",
        f"{A}launchMode": "singleTop",
        f"{A}theme": "@style/AppTheme",
    }
    attrs.update(extras)
    app.append(ET.Element("activity", attrs))
    cambios.append("actividad " + nombre_corto)


def parchear_manifest(ruta):
    ET.register_namespace("android", ANDROID)
    arbol = ET.parse(ruta)
    manifest = arbol.getroot()
    cambios = []

    # 1. LEANBACK_LAUNCHER junto a LAUNCHER, en el mismo intent-filter.
    encontrado = False
    for filtro in manifest.iter("intent-filter"):
        categorias = {c.get(f"{A}name") for c in filtro.findall("category")}
        if "android.intent.category.LAUNCHER" not in categorias:
            continue
        encontrado = True
        if "android.intent.category.LEANBACK_LAUNCHER" not in categorias:
            ET.SubElement(filtro, "category", {f"{A}name": "android.intent.category.LEANBACK_LAUNCHER"})
            cambios.append("categoria LEANBACK_LAUNCHER")
    if not encontrado:
        raise SystemExit("error: no encuentro el intent-filter con LAUNCHER en el manifest")

    # 2. Características opcionales. Sin touchscreen=false el televisor descarta la app.
    ya = {u.get(f"{A}name"): u for u in manifest.findall("uses-feature")}
    for nombre in CARACTERISTICAS_OPCIONALES:
        if nombre in ya:
            ya[nombre].set(f"{A}required", "false")
        else:
            manifest.append(ET.Element("uses-feature", {f"{A}name": nombre, f"{A}required": "false"}))
            cambios.append(f"uses-feature {nombre.rsplit('.', 1)[-1]}")

    permisos = {p.get(f"{A}name") for p in manifest.findall("uses-permission")}
    for nombre in PERMISOS:
        if nombre not in permisos:
            manifest.append(ET.Element("uses-permission", {f"{A}name": nombre}))
            cambios.append(f"permiso {nombre.rsplit('.', 1)[-1]}")

    # 3. Atributos de <application>, entre ellos el banner del lanzador.
    app = manifest.find("application")
    if app is None:
        raise SystemExit("error: el manifest no tiene <application>")
    for clave, valor in ATRIBUTOS_APP.items():
        if app.get(f"{A}{clave}") != valor:
            app.set(f"{A}{clave}", valor)
            cambios.append(f"application {clave}")

    # 4. Activities de ExoPlayer (móvil) y LibVLC (TV).
    # VLC va en :vlc para que un aborto nativo no mate el menú del WebView.
    asegurar_actividad(app, "PlayerActivity", cambios)
    asegurar_actividad(app, "VlcPlayerActivity", cambios, {
        f"{A}process": ":vlc",
        f"{A}excludeFromRecents": "true",
    })

    indentar(manifest)
    arbol.write(ruta, encoding="utf-8", xml_declaration=True)
    return cambios


def copiar_recursos(base):
    hechos = []
    parejas = [
        (CONFIG / "tv_banner.png", base / "src/main/res/drawable/tv_banner.png"),
        (CONFIG / "network_security_config.xml", base / "src/main/res/xml/network_security_config.xml"),
        (EXO / "activity_player.xml", base / "src/main/res/layout/activity_player.xml"),
        (EXO / "activity_vlc.xml", base / "src/main/res/layout/activity_vlc.xml"),
        (EXO / "overlay_player.xml", base / "src/main/res/layout/overlay_player.xml"),
        (EXO / "overlay_vlc.xml", base / "src/main/res/layout/overlay_vlc.xml"),
    ]
    for origen, destino in parejas:
        if not origen.exists():
            raise SystemExit(f"error: falta {origen.relative_to(RAIZ)}")
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(origen, destino)
        hechos.append(str(destino.relative_to(base)))
    return hechos


def encontrar_mainactivity(base: Path) -> Path:
    java = list((base / "src/main/java").rglob("MainActivity.java"))
    if java:
        return java[0]
    kotlin = list((base / "src/main/kotlin").rglob("MainActivity.kt"))
    if kotlin:
        return kotlin[0]
    raise SystemExit("error: no encuentro MainActivity tras cap add")


def paquete_de(main: Path, base: Path) -> str:
    raiz_java = base / "src/main/java"
    raiz_kt = base / "src/main/kotlin"
    raiz = raiz_java if raiz_java in main.parents else raiz_kt
    return ".".join(main.parent.relative_to(raiz).parts)


def escribir_java(origen: Path, destino: Path, paquete: str):
    texto = origen.read_text(encoding="utf-8").replace("PACKAGE_NAME", paquete)
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(texto, encoding="utf-8")


def copiar_exoplayer(base: Path) -> list:
    main = encontrar_mainactivity(base)
    paquete = paquete_de(main, base)
    hechos = []
    for nombre in JAVA_PLUGINS:
        origen = EXO / nombre
        if not origen.exists():
            raise SystemExit(f"error: falta {origen.relative_to(RAIZ)}")
        destino = main.parent / nombre
        escribir_java(origen, destino, paquete)
        hechos.append(str(destino.relative_to(base)))

    if main.suffix == ".kt":
        main.write_text(
            "package " + paquete + "\n\n"
            "import android.os.Bundle\n"
            "import com.getcapacitor.BridgeActivity\n"
            "import com.getcapacitor.Plugin\n\n"
            "class MainActivity : BridgeActivity() {\n"
            "    override fun onCreate(savedInstanceState: Bundle?) {\n"
            "        registerPlugin(StreamBoxPlugin::class.java)\n"
            "        // Class.forName: en TV no se resuelve NativePlayerPlugin (Media3)\n"
            "        // en el constant pool al cargar MainActivity.\n"
            "        val plugin = if (StreamBoxPlugin.esTelevisor(this)) {\n"
            "            Class.forName(\"$paquete.TvPlayerPlugin\")\n"
            "        } else {\n"
            "            Class.forName(\"$paquete.NativePlayerPlugin\")\n"
            "        }\n"
            "        @Suppress(\"UNCHECKED_CAST\")\n"
            "        registerPlugin(plugin as Class<out Plugin>)\n"
            "        super.onCreate(savedInstanceState)\n"
            "    }\n"
            "}\n",
            encoding="utf-8",
        )
    else:
        main.write_text(
            "package " + paquete + ";\n\n"
            "import android.os.Bundle;\n"
            "import com.getcapacitor.BridgeActivity;\n"
            "import com.getcapacitor.Plugin;\n\n"
            "public class MainActivity extends BridgeActivity {\n"
            "    @Override\n"
            "    public void onCreate(Bundle savedInstanceState) {\n"
            "        registerPlugin(StreamBoxPlugin.class);\n"
            "        // Class.forName: en TV no se resuelve NativePlayerPlugin (Media3)\n"
            "        // en el constant pool al cargar MainActivity.\n"
            "        try {\n"
            "            String pkg = \"" + paquete + "\";\n"
            "            Class<?> plugin = StreamBoxPlugin.esTelevisor(this)\n"
            "                ? Class.forName(pkg + \".TvPlayerPlugin\")\n"
            "                : Class.forName(pkg + \".NativePlayerPlugin\");\n"
            "            registerPlugin((Class<? extends Plugin>) plugin);\n"
            "        } catch (ClassNotFoundException e) {\n"
            "            throw new RuntimeException(e);\n"
            "        }\n"
            "        super.onCreate(savedInstanceState);\n"
            "    }\n"
            "}\n",
            encoding="utf-8",
        )
    hechos.append(str(main.relative_to(base)) + " (plugins StreamBox + NativePlayer/TV)")
    return hechos


def parchear_gradle(ruta: Path) -> list:
    if not ruta.exists():
        raise SystemExit(f"error: no existe {ruta}")
    texto = ruta.read_text(encoding="utf-8")
    hechos = []

    if "libvlc-all" not in texto:
        if "media3-exoplayer" in texto:
            # Había solo Media3: añadir LibVLC detrás del bloque media3-ui.
            if f'implementation "org.videolan.android:libvlc-all:{LIBVLC}"' not in texto:
                texto = texto.replace(
                    f'    implementation "androidx.media3:media3-ui:{MEDIA3}"',
                    f'    implementation "androidx.media3:media3-ui:{MEDIA3}"\n'
                    f'    implementation "org.videolan.android:libvlc-all:{LIBVLC}"',
                    1,
                )
                hechos.append("gradle: LibVLC " + LIBVLC)
        else:
            patron = re.compile(r"implementation project\(['\"]:capacitor-android['\"]\)")
            match = patron.search(texto)
            if not match:
                raise SystemExit("error: no encuentro capacitor-android en app/build.gradle")
            ancla = match.group(0)
            bloque = ancla + "\n" + "\n".join(DEPS_PLAYER)
            texto = texto.replace(ancla, bloque, 1)
            hechos.append("gradle: Media3 " + MEDIA3 + " + LibVLC " + LIBVLC)
    else:
        hechos.append("gradle: LibVLC ya estaba")

    if "media3-exoplayer" not in texto and "libvlc-all" in texto:
        # Caso raro: solo VLC; añadir Media3 para el móvil.
        texto = texto.replace(
            f'    implementation "org.videolan.android:libvlc-all:{LIBVLC}"',
            "\n".join(DEPS_PLAYER),
            1,
        )
        hechos.append("gradle: Media3 añadido para móvil")

    # Evitar conflictos de libc++_shared.so entre Media3/VLC y Capacitor (AGP 8).
    if "libc++_shared.so" not in texto:
        if "android {" in texto and "packaging {" not in texto and "packagingOptions" not in texto:
            texto = texto.replace(
                "android {",
                "android {\n"
                "    packaging {\n"
                "        jniLibs {\n"
                "            pickFirsts += ['lib/**/libc++_shared.so', 'lib/**/libvlc.so']\n"
                "        }\n"
                "        resources {\n"
                "            pickFirsts += ['META-INF/INDEX.LIST', 'META-INF/DEPENDENCIES']\n"
                "        }\n"
                "    }",
                1,
            )
            hechos.append("gradle: packaging jniLibs pickFirst")

    # El APK de TV no necesita x86; reduce tamaño (LibVLC es gordo).
    if "abiFilters" not in texto and "defaultConfig" in texto:
        texto = re.sub(
            r"(defaultConfig\s*\{)",
            r"\1\n        ndk {\n"
            r"            abiFilters 'armeabi-v7a', 'arm64-v8a'\n"
            r"        }",
            texto,
            count=1,
        )
        hechos.append("gradle: abiFilters armeabi-v7a + arm64-v8a")

    ruta.write_text(texto, encoding="utf-8")
    return hechos or ["gradle: sin cambios"]


def main():
    base = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "native" / "android" / "app"
    if base.name != "app":
        base = base / "app"
    manifest = base / "src/main/AndroidManifest.xml"
    if not manifest.exists():
        raise SystemExit(f"error: no existe {manifest}\nejecuta antes: npx cap add android")

    print("parcheando para Android TV + LibVLC (TV) / ExoPlayer (móvil)")
    for r in copiar_recursos(base):
        print(f"  recurso: {r}")
    for r in copiar_exoplayer(base):
        print(f"  nativo: {r}")
    for c in parchear_gradle(base / "build.gradle"):
        print(f"  {c}")
    cambios = parchear_manifest(manifest)
    for c in cambios:
        print(f"  manifest: {c}")
    if not cambios:
        print("  manifest: ya estaba al día")
    print("listo")


if __name__ == "__main__":
    main()
