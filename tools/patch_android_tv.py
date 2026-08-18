#!/usr/bin/env python3
"""Convierte el proyecto Android de Capacitor en una app de Android TV
con reproductor nativo ExoPlayer (Media3).

`npx cap add android` genera un proyecto pensado para móvil. Para que el
televisor la acepte y la muestre en su pantalla de inicio hacen falta cuatro
cosas que Capacitor no pone:

  1. La categoría LEANBACK_LAUNCHER en el intent-filter de arranque.
  2. touchscreen declarado como no obligatorio (un televisor no tiene táctil).
  3. Un banner de 320x180, que en leanback es lo único que ve el usuario.
  4. La configuración de red que permite tráfico http a los orígenes IPTV.

Además se inyecta ExoPlayer: el WebView de Fire Stick no decodifica bien
MPEG-TS con mse, así que la web llama a un plugin nativo. En TV el vídeo
empieza en la ventana pequeña (overlay TextureView) y pasa a pantalla
completa con el segundo OK. Si el overlay no se puede montar, se abre
PlayerActivity como antes.

El WebView de Android TV usa un User-Agent de Chrome de móvil, sin "TV".
StreamBoxPlugin detecta leanback / UI_MODE_TYPE_TELEVISION e inyecta
window.StreamBoxNative = { isTv, hasExo } antes de core.js.

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
DEPS_MEDIA3 = [
    f'    implementation "androidx.media3:media3-exoplayer:{MEDIA3}"',
    f'    implementation "androidx.media3:media3-exoplayer-hls:{MEDIA3}"',
    f'    implementation "androidx.media3:media3-ui:{MEDIA3}"',
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

    # 4. Activity de ExoPlayer a pantalla completa.
    tiene_player = False
    for act in app.findall("activity"):
        nombre = act.get(f"{A}name") or ""
        if nombre.endswith("PlayerActivity"):
            tiene_player = True
            break
    if not tiene_player:
        app.append(ET.Element("activity", {
            f"{A}name": ".PlayerActivity",
            f"{A}configChanges": "keyboard|keyboardHidden|orientation|screenSize|smallestScreenSize|screenLayout|uiMode",
            f"{A}exported": "false",
            f"{A}hardwareAccelerated": "true",
            f"{A}launchMode": "singleTop",
            f"{A}theme": "@style/AppTheme",
        }))
        cambios.append("actividad PlayerActivity")

    indentar(manifest)
    arbol.write(ruta, encoding="utf-8", xml_declaration=True)
    return cambios


def copiar_recursos(base):
    hechos = []
    parejas = [
        (CONFIG / "tv_banner.png", base / "src/main/res/drawable/tv_banner.png"),
        (CONFIG / "network_security_config.xml", base / "src/main/res/xml/network_security_config.xml"),
        (EXO / "activity_player.xml", base / "src/main/res/layout/activity_player.xml"),
        (EXO / "overlay_player.xml", base / "src/main/res/layout/overlay_player.xml"),
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
    for nombre in ("NativePlayerPlugin.java", "PlayerActivity.java", "StreamBoxPlugin.java"):
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
            "import com.getcapacitor.BridgeActivity\n\n"
            "class MainActivity : BridgeActivity() {\n"
            "    override fun onCreate(savedInstanceState: Bundle?) {\n"
            "        registerPlugin(StreamBoxPlugin::class.java)\n"
            "        registerPlugin(NativePlayerPlugin::class.java)\n"
            "        super.onCreate(savedInstanceState)\n"
            "    }\n"
            "}\n",
            encoding="utf-8",
        )
    else:
        main.write_text(
            "package " + paquete + ";\n\n"
            "import android.os.Bundle;\n"
            "import com.getcapacitor.BridgeActivity;\n\n"
            "public class MainActivity extends BridgeActivity {\n"
            "    @Override\n"
            "    public void onCreate(Bundle savedInstanceState) {\n"
            "        registerPlugin(StreamBoxPlugin.class);\n"
            "        registerPlugin(NativePlayerPlugin.class);\n"
            "        super.onCreate(savedInstanceState);\n"
            "    }\n"
            "}\n",
            encoding="utf-8",
        )
    hechos.append(str(main.relative_to(base)) + " (plugins StreamBox + NativePlayer)")
    return hechos


def parchear_gradle(ruta: Path) -> list:
    if not ruta.exists():
        raise SystemExit(f"error: no existe {ruta}")
    texto = ruta.read_text(encoding="utf-8")
    if "media3-exoplayer" in texto:
        return ["gradle: Media3 ya estaba"]
    patron = re.compile(r"implementation project\(['\"]:capacitor-android['\"]\)")
    match = patron.search(texto)
    if not match:
        raise SystemExit("error: no encuentro capacitor-android en app/build.gradle")
    ancla = match.group(0)
    bloque = ancla + "\n" + "\n".join(DEPS_MEDIA3)
    ruta.write_text(texto.replace(ancla, bloque, 1), encoding="utf-8")
    return ["gradle: Media3 ExoPlayer " + MEDIA3]


def main():
    base = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "native" / "android" / "app"
    if base.name != "app":
        base = base / "app"
    manifest = base / "src/main/AndroidManifest.xml"
    if not manifest.exists():
        raise SystemExit(f"error: no existe {manifest}\nejecuta antes: npx cap add android")

    print("parcheando para Android TV + ExoPlayer")
    for r in copiar_recursos(base):
        print(f"  recurso: {r}")
    for r in copiar_exoplayer(base):
        print(f"  exoplayer: {r}")
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
