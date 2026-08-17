#!/usr/bin/env python3
"""Genera el banner de Android TV (320x180) que exige el lanzador leanback.

Sin `android:banner` la app no se puede mostrar en la pantalla de inicio de un
televisor. El banner debe llevar el nombre, porque en leanback no hay etiqueta
de texto debajo: el banner es todo lo que ve el usuario.

Se dibuja con una fuente de mapa de bits mínima en lugar de depender de tipos
del sistema, para que el resultado sea idéntico en cualquier máquina.

Uso: python3 tools/make_tv_banner.py
"""

import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from make_icons import BLANCO, MUESTREO, color_figura  # noqa: E402

ANCHO, ALTO = 320, 180
FONDO_INI = (0x0B, 0x12, 0x20)
FONDO_FIN = (0x1E, 0x1B, 0x4B)

# Fuente 5x7. Solo las letras de "STREAMBOX IPTV": añadir más es trivial.
FUENTE = {
    "S": ("01111", "10000", "10000", "01110", "00001", "00001", "11110"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "M": ("10001", "11011", "10101", "10001", "10001", "10001", "10001"),
    "B": ("11110", "10001", "10001", "11110", "10001", "10001", "11110"),
    "O": ("01110", "10001", "10001", "10001", "10001", "10001", "01110"),
    "X": ("10001", "10001", "01010", "00100", "01010", "10001", "10001"),
    "I": ("11111", "00100", "00100", "00100", "00100", "00100", "11111"),
    "P": ("11110", "10001", "10001", "11110", "10000", "10000", "10000"),
    "V": ("10001", "10001", "10001", "10001", "10001", "01010", "00100"),
    " ": ("00000",) * 7,
}

LOGO_LADO = 104
LOGO_X, LOGO_Y = 20, 38
TEXTO_X = 142


def pintar_texto(pixeles, texto, x0, y0, escala, color):
    for i, ch in enumerate(texto):
        glifo = FUENTE.get(ch)
        if not glifo:
            continue
        base = x0 + i * 6 * escala
        for fy, fila in enumerate(glifo):
            for fx, bit in enumerate(fila):
                if bit != "1":
                    continue
                for dy in range(escala):
                    for dx in range(escala):
                        x, y = base + fx * escala + dx, y0 + fy * escala + dy
                        if 0 <= x < ANCHO and 0 <= y < ALTO:
                            pixeles[y][x] = color


def main():
    # Fondo: degradado diagonal suave del azul del tema al índigo.
    pixeles = [[None] * ANCHO for _ in range(ALTO)]
    for y in range(ALTO):
        for x in range(ANCHO):
            t = (x / ANCHO + y / ALTO) / 2
            pixeles[y][x] = tuple(round(FONDO_INI[i] + (FONDO_FIN[i] - FONDO_INI[i]) * t) for i in range(3))

    # Logo con supermuestreo, compuesto sobre el fondo ya calculado.
    for py in range(LOGO_LADO):
        for px in range(LOGO_LADO):
            acum = [0, 0, 0, 0]
            for sy in range(MUESTREO):
                for sx in range(MUESTREO):
                    c = color_figura(px + (sx + 0.5) / MUESTREO, py + (sy + 0.5) / MUESTREO, LOGO_LADO)
                    if c is not None:
                        acum[0] += c[0]; acum[1] += c[1]; acum[2] += c[2]; acum[3] += 255
            cubiertas = acum[3] // 255
            if not cubiertas:
                continue
            n = MUESTREO * MUESTREO
            figura = (acum[0] // cubiertas, acum[1] // cubiertas, acum[2] // cubiertas)
            alfa = (acum[3] // n) / 255.0
            x, y = LOGO_X + px, LOGO_Y + py
            if 0 <= x < ANCHO and 0 <= y < ALTO:
                fondo = pixeles[y][x]
                pixeles[y][x] = tuple(round(figura[i] * alfa + fondo[i] * (1 - alfa)) for i in range(3))

    pintar_texto(pixeles, "STREAMBOX", TEXTO_X, 56, 3, BLANCO)
    pintar_texto(pixeles, "IPTV", TEXTO_X, 100, 3, (0xA5, 0xB4, 0xFC))

    filas = [bytes(b for px in fila for b in (px[0], px[1], px[2], 255)) for fila in pixeles]

    destino = RAIZ / "native" / "android-config"
    destino.mkdir(parents=True, exist_ok=True)
    ruta = destino / "tv_banner.png"
    # El PNG del banner es opaco: la transparencia se ve mal en el lanzador.
    n = escribir_png_rect(ruta, filas, ANCHO, ALTO)
    print(f"  tv_banner.png: {ANCHO}x{ALTO}, {n} bytes")


def escribir_png_rect(ruta, filas, ancho, alto):
    import struct
    import zlib

    cruda = b"".join(b"\x00" + f for f in filas)

    def trozo(tipo, datos):
        c = struct.pack(">I", len(datos)) + tipo + datos
        return c + struct.pack(">I", zlib.crc32(tipo + datos) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += trozo(b"IHDR", struct.pack(">IIBBBBB", ancho, alto, 8, 6, 0, 0, 0))
    png += trozo(b"IDAT", zlib.compress(cruda, 9))
    png += trozo(b"IEND", b"")
    ruta.write_bytes(png)
    return len(png)


if __name__ == "__main__":
    main()
