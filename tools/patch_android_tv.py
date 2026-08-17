#!/usr/bin/env python3
"""Convierte el proyecto Android de Capacitor en una app de Android TV.

`npx cap add android` genera un proyecto pensado para móvil. Para que el
televisor la acepte y la muestre en su pantalla de inicio hacen falta cuatro
cosas que Capacitor no pone:

  1. La categoría LEANBACK_LAUNCHER en el intent-filter de arranque.
  2. touchscreen declarado como no obligatorio (un televisor no tiene táctil).
  3. Un banner de 320x180, que en leanback es lo único que ve el usuario.
  4. La configuración de red que permite tráfico http a los orígenes IPTV.

Se edita el XML con ElementTree en vez de con expresiones regulares porque el
manifest de Capacitor cambia de forma entre versiones. Es idempotente: se puede
ejecutar varias veces sin duplicar nada.

Uso: python3 tools/patch_android_tv.py [ruta/al/proyecto/android]
"""

import shutil
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CONFIG = RAIZ / "native" / "android-config"
ANDROID = "http://schemas.android.com/apk/res/android"
A = f"{{{ANDROID}}}"

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

    indentar(manifest)
    arbol.write(ruta, encoding="utf-8", xml_declaration=True)
    return cambios


def copiar_recursos(base):
    hechos = []
    parejas = [
        (CONFIG / "tv_banner.png", base / "src/main/res/drawable/tv_banner.png"),
        (CONFIG / "network_security_config.xml", base / "src/main/res/xml/network_security_config.xml"),
    ]
    for origen, destino in parejas:
        if not origen.exists():
            raise SystemExit(f"error: falta {origen.relative_to(RAIZ)} (genera el banner con make_tv_banner.py)")
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(origen, destino)
        hechos.append(str(destino.relative_to(base)))
    return hechos


def main():
    base = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "native" / "android" / "app"
    if base.name != "app":
        base = base / "app"
    manifest = base / "src/main/AndroidManifest.xml"
    if not manifest.exists():
        raise SystemExit(f"error: no existe {manifest}\nejecuta antes: npx cap add android")

    print("parcheando para Android TV")
    for r in copiar_recursos(base):
        print(f"  recurso: {r}")
    cambios = parchear_manifest(manifest)
    for c in cambios:
        print(f"  manifest: {c}")
    if not cambios:
        print("  manifest: ya estaba al día")
    print("listo")


if __name__ == "__main__":
    main()
