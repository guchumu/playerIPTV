#!/usr/bin/env python3
"""Añade App Transport Security laxa al proyecto iOS de Capacitor.

Los streams Xtream suelen ir por HTTP. iOS los bloquea por defecto (ATS).
Tras `npx cap add ios`, este script pone NSAllowsArbitraryLoads (y la clave
equivalente del WKWebView) en Info.plist.

También relaja la firma de los Pods: el IPA firmado lo firma el target App;
sin certificado de Apple, xcodebuild puede generar el .app sin firmar.

Uso: python3 tools/patch_ios.py [ruta/al/proyecto/ios]
"""

import plistlib
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

POD_SIGNING = """
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
      config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
    end
  end
"""


def encontrar_plist(base: Path) -> Path:
    candidatos = [
        base / "App" / "App" / "Info.plist",
        base / "App" / "Info.plist",
    ]
    for c in candidatos:
        if c.is_file():
            return c
    hallados = [
        p for p in base.rglob("Info.plist")
        if "Pods" not in p.parts and "Tests" not in p.parts
    ]
    for p in hallados:
        if p.parent.name == "App":
            return p
    if hallados:
        return hallados[0]
    raise SystemExit(f"error: no encuentro Info.plist en {base}")


def parchear_plist(ruta: Path) -> list:
    with ruta.open("rb") as f:
        datos = plistlib.load(f)
    cambios = []
    ats = datos.get("NSAppTransportSecurity")
    if not isinstance(ats, dict):
        ats = {}
        datos["NSAppTransportSecurity"] = ats
        cambios.append("NSAppTransportSecurity creado")
    if ats.get("NSAllowsArbitraryLoads") is not True:
        ats["NSAllowsArbitraryLoads"] = True
        cambios.append("NSAllowsArbitraryLoads = true")
    # WKWebView (Capacitor) no hereda siempre NSAllowsArbitraryLoads.
    if ats.get("NSAllowsArbitraryLoadsInWebContent") is not True:
        ats["NSAllowsArbitraryLoadsInWebContent"] = True
        cambios.append("NSAllowsArbitraryLoadsInWebContent = true")
    with ruta.open("wb") as f:
        plistlib.dump(datos, f, sort_keys=False)
    return cambios


def parchear_podfile(ruta: Path) -> list:
    if not ruta.exists():
        return []
    texto = ruta.read_text(encoding="utf-8")
    if "CODE_SIGNING_ALLOWED" in texto:
        return ["Podfile: firma de Pods ya desactivada"]
    ancla = "assertDeploymentTarget(installer)"
    if ancla in texto:
        texto = texto.replace(ancla, ancla + POD_SIGNING, 1)
    else:
        texto += (
            "\npost_install do |installer|\n"
            + POD_SIGNING
            + "end\n"
        )
    ruta.write_text(texto, encoding="utf-8")
    return ["Podfile: CODE_SIGNING_ALLOWED=NO en Pods"]


def main():
    base = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "native" / "ios"
    if not base.exists():
        raise SystemExit(
            f"error: no existe {base}\nejecuta antes: npx cap add ios"
        )
    plist = encontrar_plist(base)
    print(f"parcheando ATS en {plist}")
    cambios = parchear_plist(plist)
    for c in cambios:
        print(f"  plist: {c}")
    if not cambios:
        print("  plist: ya estaba al día")
    podfile = base / "App" / "Podfile"
    for c in parchear_podfile(podfile):
        print(f"  {c}")
    print("listo")


if __name__ == "__main__":
    main()
