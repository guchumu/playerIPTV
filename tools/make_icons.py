#!/usr/bin/env python3
"""Genera los iconos PNG de la PWA a partir de la forma de logo.svg.

El logo original solo existía a 200x200, pero el manifest lo declaraba también
como 512x512. Chrome necesita un icono real de 512 para ofrecer la instalación,
así que en lugar de ampliar un PNG pequeño se vuelve a dibujar la figura al
tamaño que haga falta.

La variante "maskable" lleva la figura reducida dentro del lienzo: Android
recorta el icono a la forma del sistema (círculo, rombo...) y sin ese margen de
seguridad se come los bordes del dibujo.

Uso: python3 tools/make_icons.py
"""

import struct
import zlib
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

DEGRADADO_INI = (0x66, 0x7E, 0xEA)
DEGRADADO_FIN = (0x76, 0x4B, 0xA2)
BLANCO = (0xFF, 0xFF, 0xFF)
# Fondo del tema, para que el icono maskable no muestre transparencia.
FONDO = (0x02, 0x06, 0x17)

MUESTREO = 4  # Supermuestreo por eje para conseguir bordes suaves.


def dentro_circulo(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def dentro_triangulo(x, y, pts):
    (x1, y1), (x2, y2), (x3, y3) = pts

    def signo(ax, ay, bx, by):
        return (x - bx) * (ay - by) - (ax - bx) * (y - by)

    d1 = signo(x1, y1, x2, y2)
    d2 = signo(x2, y2, x3, y3)
    d3 = signo(x3, y3, x1, y1)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


def dentro_barra_redondeada(x, y, x0, y0, ancho, alto, radio):
    x1, y1 = x0 + ancho, y0 + alto
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    # Esquinas: solo hay que comprobar el radio en las cuatro cajas de esquina.
    for ex, ey in ((x0 + radio, y0 + radio), (x1 - radio, y0 + radio), (x0 + radio, y1 - radio), (x1 - radio, y1 - radio)):
        if (x < x0 + radio or x > x1 - radio) and (y < y0 + radio or y > y1 - radio):
            if abs(x - ex) <= radio and abs(y - ey) <= radio:
                return dentro_circulo(x, y, ex, ey, radio)
    return True


def color_figura(x, y, lado):
    """Devuelve el color de la figura en un punto, o None si es fondo.

    Las coordenadas del SVG original van sobre un lienzo de 200; aquí se
    normalizan para poder dibujar a cualquier resolución.
    """
    e = lado / 200.0
    if dentro_barra_redondeada(x, y, 30 * e, 160 * e, 140 * e, 8 * e, 4 * e):
        return BLANCO
    if dentro_triangulo(x, y, ((80 * e, 60 * e), (80 * e, 140 * e), (140 * e, 100 * e))):
        return BLANCO
    if dentro_circulo(x, y, 100 * e, 100 * e, 90 * e):
        # Degradado diagonal, igual que el linearGradient del SVG.
        t = max(0.0, min(1.0, (x + y) / (2.0 * lado)))
        return tuple(round(DEGRADADO_INI[i] + (DEGRADADO_FIN[i] - DEGRADADO_INI[i]) * t) for i in range(3))
    return None


def dibujar(tamano, margen=0.0, fondo_opaco=False):
    """Devuelve filas RGBA. `margen` es la fracción de lienzo libre por lado."""
    figura = tamano * (1.0 - 2 * margen)
    desp = tamano * margen
    filas = []
    for py in range(tamano):
        fila = bytearray()
        for px in range(tamano):
            acum = [0, 0, 0, 0]
            for sy in range(MUESTREO):
                for sx in range(MUESTREO):
                    x = px + (sx + 0.5) / MUESTREO - desp
                    y = py + (sy + 0.5) / MUESTREO - desp
                    c = color_figura(x, y, figura)
                    if c is None:
                        if fondo_opaco:
                            acum[0] += FONDO[0]; acum[1] += FONDO[1]; acum[2] += FONDO[2]; acum[3] += 255
                    else:
                        acum[0] += c[0]; acum[1] += c[1]; acum[2] += c[2]; acum[3] += 255
            n = MUESTREO * MUESTREO
            # La opacidad es la fracción de muestras cubiertas; el color es la
            # media entre las cubiertas, no entre todas: promediar con las
            # vacías oscurecería la figura entera.
            cubiertas = acum[3] // 255
            if cubiertas == 0:
                fila += bytes((0, 0, 0, 0))
            else:
                fila += bytes((acum[0] // cubiertas, acum[1] // cubiertas, acum[2] // cubiertas, acum[3] // n))
        filas.append(bytes(fila))
    return filas


def escribir_png(ruta, filas, tamano):
    cruda = b"".join(b"\x00" + f for f in filas)

    def trozo(tipo, datos):
        c = struct.pack(">I", len(datos)) + tipo + datos
        return c + struct.pack(">I", zlib.crc32(tipo + datos) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += trozo(b"IHDR", struct.pack(">IIBBBBB", tamano, tamano, 8, 6, 0, 0, 0))
    png += trozo(b"IDAT", zlib.compress(cruda, 9))
    png += trozo(b"IEND", b"")
    ruta.write_bytes(png)
    return len(png)


def main():
    destino = RAIZ / "icons"
    destino.mkdir(exist_ok=True)

    trabajos = [
        ("icon-192.png", 192, 0.0, False),
        ("icon-512.png", 512, 0.0, False),
        # Zona de seguridad del 10% por lado: Android recorta hasta un 20%.
        ("icon-maskable-512.png", 512, 0.14, True),
    ]
    for nombre, tamano, margen, opaco in trabajos:
        filas = dibujar(tamano, margen, opaco)
        n = escribir_png(destino / nombre, filas, tamano)
        print(f"  {nombre}: {tamano}x{tamano}, {n} bytes")


if __name__ == "__main__":
    main()
