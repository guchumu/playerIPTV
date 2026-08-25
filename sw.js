/**
 * Service worker de StreamBox.
 *
 * Existe por dos motivos: Chrome exige un service worker con manejador de
 * `fetch` para ofrecer instalar la aplicación, y así el envoltorio de la app
 * sigue abriendo con una conexión mala en lugar de mostrar el error del
 * navegador.
 *
 * Estrategia deliberadamente "red primero" y nunca "caché primero". Toda la
 * jornada hemos peleado con versiones desplegadas a medias, y una caché
 * agresiva convertiría cualquier arreglo futuro en un misterio: el usuario
 * seguiría viendo código viejo sin entender por qué. Aquí la caché es solo una
 * red de seguridad para cuando la red falla.
 */
const VERSION = "streambox-20260824e";

// Nunca se toca: los .php son el relé de vídeo, los proxies y las APIs de
// estado. Guardar o reutilizar cualquiera de esas respuestas rompería la
// reproducción y el login de formas muy difíciles de diagnosticar.
function esGestionable(peticion, url) {
  if (peticion.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.endsWith(".php")) return false;
  return true;
}

function sePuedeGuardar(respuesta) {
  // Las respuestas parciales (206) y las opacas no se pueden reutilizar.
  return respuesta && respuesta.status === 200 && respuesta.type === "basic";
}

self.addEventListener("install", (evento) => {
  // Entrar en servicio sin esperar a que se cierren las pestañas viejas.
  evento.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(nombres.filter((n) => n !== VERSION).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (evento) => {
  const url = new URL(evento.request.url);
  if (!esGestionable(evento.request, url)) return;

  evento.respondWith(
    (async () => {
      try {
        const respuesta = await fetch(evento.request);
        if (sePuedeGuardar(respuesta)) {
          const cache = await caches.open(VERSION);
          cache.put(evento.request, respuesta.clone());
        }
        return respuesta;
      } catch (e) {
        const guardada = await caches.match(evento.request);
        if (guardada) return guardada;
        // Una navegación sin red debe caer en la portada si está guardada,
        // no en la pantalla de error del navegador.
        if (evento.request.mode === "navigate") {
          const portada = await caches.match("index.html");
          if (portada) return portada;
        }
        throw e;
      }
    })()
  );
});

// Permite forzar el borrado de la caché desde la página si algo se queda pillado.
self.addEventListener("message", (evento) => {
  if (evento.data === "limpiar-cache") {
    evento.waitUntil(caches.keys().then((ns) => Promise.all(ns.map((n) => caches.delete(n)))));
  }
});
