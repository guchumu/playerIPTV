/*******************************************************
 * STREAMBOX IPTV - CORE.JS (backup que funcionaba + mejoras)
 * Login Xtream / M3U, get.php output=ts, parseM3U, mpegts/HLS
 *******************************************************/

if (!window.CSS) window.CSS = {};
if (!CSS.escape) {
  CSS.escape = function (value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  };
}

const EPG_URL = "epg_api.php";

let currentServer = "";
let hls = null;
let mpegtsPlayer = null;
const BUFFER_KEY = "streambox_buffer";
const DEFAULT_BUFFER_SECONDS = 15;
let currentUser = null;
let channelsData = [];
let categoriesData = {};
let currentCategory = null;
let currentlyPlayingId = null;
let epgIndex = {};
let epgAliases = {};
let epgResolvedIds = {};
let epgLoadedAt = 0;
let epgRefreshTimer = null;
let epgReloadTimer = null;
let epgRetryTimer = null;
let epgRetryIndex = 0;
let epgLastStatus = "sin intentar";
let loginCancelled = false;
let teardownInProgress = false;
let teardownTimer = null;
const EPG_RETRY_DELAYS = [8000, 20000, 45000, 90000, 180000, 300000];
let channelById = new Map();
let pollingInterval = null;
let sessionToken = null;
let activityInterval = null;
let heartbeatInterval = null;
let activeConnection = null;

const video = document.getElementById("videoPlayer");
const spinner = document.getElementById("spinner");
const globalSpinner = document.getElementById("globalSpinner");
const globalSpinnerText = document.getElementById("globalSpinnerText");
const channelsContainer = document.getElementById("channelsContainer");
const categoriesContainer = document.getElementById("categoriesContainer");
const channelColumnTitle = document.getElementById("channelColumnTitle");
const epgNowEl = document.getElementById("epgNow");
const epgNextEl = document.getElementById("epgNext");

let lastParseDebug = null;
let debugZeroCount = 0;
let debugZeroTimer = null;
let debugTitleTaps = 0;
let debugTitleTimer = null;
let currentFocus = { col: 1, row: 0 };

function showSpinner(show, message) {
  if (globalSpinner) {
    globalSpinner.classList.toggle("is-visible", !!show);
    globalSpinner.hidden = !show;
    if (globalSpinnerText && message) globalSpinnerText.textContent = message;
  }
}

// Carga o rebuffering de un canal: solo tapa el vídeo, nunca la aplicación
// entera como hace el spinner global del login.
let bufferingSpinnerTimer = null;

function showVideoSpinner(show) {
  clearTimeout(bufferingSpinnerTimer);
  bufferingSpinnerTimer = null;
  if (spinner) spinner.style.display = show ? "flex" : "none";
}

function setLoginStatus(message) {
  const loginError = document.getElementById("loginError");
  if (loginError) loginError.textContent = message || "";
}

function detectDevice() {
  const ua = navigator.userAgent || "";
  const isFireTV = /AFT|AmazonWebAppPlatform|Silk/i.test(ua);
  const isAndroidTV = /Android/i.test(ua) && /(TV|AOSP)/i.test(ua);
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const noHover = window.matchMedia("(hover: none)").matches;
  const wide = Math.max(window.innerWidth, window.screen.width) >= 960;
  const isTV = isFireTV || isAndroidTV || (coarse && noHover && wide && window.innerHeight >= 500);
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isMobile = !isTV && window.innerWidth <= 768;
  document.body.classList.toggle("is-tv", isTV);
  document.body.classList.toggle("is-mobile", isMobile);
  document.body.classList.toggle("is-ios", isIOS);
  document.body.classList.toggle("is-touch", coarse || "ontouchstart" in window);
}

function getBufferSeconds() {
  const n = parseInt(localStorage.getItem(BUFFER_KEY) || String(DEFAULT_BUFFER_SECONDS), 10);
  if (!n || n < 5) return DEFAULT_BUFFER_SECONDS;
  return Math.min(90, n);
}

function setBufferSeconds(value) {
  const n = Math.min(90, Math.max(5, parseInt(value, 10) || DEFAULT_BUFFER_SECONDS));
  localStorage.setItem(BUFFER_KEY, String(n));
  return n;
}

function stopPlayback() {
  // Vaciar el <video> dispara un evento de error propio; sin esta marca el
  // reconector lo confundiría con una caída del stream.
  teardownInProgress = true;
  clearTimeout(teardownTimer);
  teardownTimer = setTimeout(() => {
    teardownInProgress = false;
  }, 400);

  try {
    if (hls) {
      hls.stopLoad();
      hls.detachMedia();
      hls.destroy();
    }
  } catch (e) {}
  hls = null;

  try {
    if (mpegtsPlayer) {
      mpegtsPlayer.pause();
      mpegtsPlayer.unload();
      mpegtsPlayer.detachMediaElement();
      mpegtsPlayer.destroy();
    }
  } catch (e) {}
  mpegtsPlayer = null;

  if (!video) return;
  try {
    video.pause();
  } catch (e) {}
  video.removeAttribute("src");
  video.removeAttribute("data-active-url");
  try {
    video.srcObject = null;
  } catch (e) {}
  try {
    video.load();
  } catch (e) {}
}

function showToast(message, ms) {
  const el = document.getElementById("appToast");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    el.classList.remove("show");
    el.hidden = true;
  }, ms || 3200);
}

function showScreen(name) {
  const login = document.getElementById("loginScreen");
  const main = document.getElementById("mainScreen");
  const showLogin = name === "login";
  if (login) {
    login.classList.toggle("active", showLogin);
    login.style.display = showLogin ? "flex" : "none";
  }
  if (main) {
    main.classList.toggle("active", !showLogin);
    main.style.display = showLogin ? "none" : "flex";
  }
}

/********** DEVICE ID & CARGA REMOTA **********/
function getDeviceId() {
  let id = localStorage.getItem("device_id");
  if (!id) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    id = "";
    for (let i = 0; i < 6; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
    id = id.match(/.{1,2}/g).join("-");
    localStorage.setItem("device_id", id);
  }
  return id;
}

function showDeviceId() {
  const deviceId = getDeviceId();
  const displayEl = document.getElementById("deviceIdDisplay");
  if (displayEl) displayEl.textContent = deviceId;
  const uploadUrlEl = document.getElementById("uploadUrlDisplay");
  if (uploadUrlEl) {
    const base = (window.location.origin + window.location.pathname).replace(/[^/]*$/, "");
    uploadUrlEl.textContent = base + "upload.php";
  }
  return deviceId;
}

function startRemotePolling() {
  const deviceId = showDeviceId();

  if (pollingInterval) clearInterval(pollingInterval);

  pollingInterval = setInterval(async () => {
    try {
      const res = await fetch("api_dispositivos.php?id=" + encodeURIComponent(deviceId));
      const data = await res.json();
      if (data && data.status !== "esperando" && (data.serverUrl || data.m3uUrl)) {
        clearInterval(pollingInterval);
        performLoginAction(data.serverUrl, data.username, data.password, data.m3uUrl);
      }
    } catch (e) {}
  }, 5000);
}

function isProxyFailure(response, data, rawText) {
  const status = response ? response.status : 0;
  const err = data && (data.error || data.message);
  const errStr = err ? String(err) : "";
  if (status >= 500 || status === 400 || status === 403) return true;
  if (data && data.error === "proxy_error") return true;
  if (/proxy_error|Error de conexión|no se pudo conectar|Endpoint no permitido|Host no permitido/i.test(errStr)) {
    return true;
  }
  if (rawText && /<!DOCTYPE|<html/i.test(rawText)) return true;
  return false;
}

function xtreamLoginFailureMessage(response, data, rawText) {
  if (isProxyFailure(response, data, rawText)) {
    const detail = data && (data.message || data.error);
    return detail && String(detail) !== "proxy_error"
      ? String(detail)
      : "No se pudo conectar con el servidor (error de red o proxy)";
  }
  return "Credenciales inválidas.";
}

/********** MOTOR CENTRAL DE LOGIN **********/
async function performLoginAction(serverUrl, username, password, m3uUrl) {
  loginCancelled = false;
  setLoginStatus("Descargando lista... Por favor espera.");
  showSpinner(true, "Conectando...");

  serverUrl = (serverUrl || "").trim();
  username = (username || "").trim();
  password = (password || "").trim();
  m3uUrl = (m3uUrl || "").trim();

  // Si hay usuario y clave, es Xtream. La M3U solo se usa cuando NO hay Xtream.
  // (Antes, un m3uUrl residual o vacío mal leído saltaba el login Xtream.)
  const hasXtream = !!(username && password);
  if (hasXtream && !serverUrl) {
    serverUrl = "http://masquecero.net";
  }

  try {
    if (!hasXtream && m3uUrl) {
      try {
        currentServer = new URL(m3uUrl).origin;
      } catch (err) {}
      const response = await fetch("xtream_proxy.php?direct_url=" + encodeURIComponent(m3uUrl));
      const m3uContent = await response.text();
      if (loginCancelled) return false;
      if (m3uContent.includes("Error al cargar") || m3uContent.trim() === "") {
        throw new Error("No se pudo cargar la URL.");
      }
      if (m3uContent.trim().charAt(0) === "{" || /<!DOCTYPE|<html/i.test(m3uContent)) {
        let msg = "No se pudo cargar la URL.";
        try {
          const err = JSON.parse(m3uContent);
          if (err && err.message) msg = err.message;
        } catch (e) {}
        throw new Error(msg);
      }

      currentUser = { username: "Invitado M3U", isM3U: true, m3uUrl: m3uUrl, server: currentServer };
      localStorage.setItem("xtream_user", JSON.stringify(currentUser));

      showSpinner(true, "Procesando canales...");
      parseM3U(m3uContent);
      if (!channelsData.length) throw new Error("La lista no contiene canales");
      finishLogin(currentUser);
      renderCategories();
      restoreLastChannel();
      checkAccountExpiryFromChannels();
      showSpinner(false);
      return true;
    }

    if (hasXtream) {
      currentServer = serverUrl;
      showSpinner(true, "Validando acceso...");
      const response = await fetchXtream("player_api.php", { username, password }, serverUrl);
      const rawText = await response.text();
      if (loginCancelled) return false;
      let data = null;
      try {
        data = JSON.parse(rawText);
      } catch (e) {
        data = null;
      }

      if (!data || !data.user_info) {
        throw new Error(
          isProxyFailure(response, data, rawText)
            ? xtreamLoginFailureMessage(response, data, rawText)
            : "No se pudo leer la respuesta del servidor Xtream"
        );
      }

      if (Number(data.user_info.auth) !== 1) {
        throw new Error("Credenciales inválidas.");
      }

      currentUser = { username, password, server: serverUrl, info: data.user_info, isM3U: false };
      localStorage.setItem("xtream_user", JSON.stringify(currentUser));

      finishLogin(currentUser);
      setLoginStatus("Descargando canales...");
      showSpinner(true, "Descargando canales...");
      await loadM3UFromXtream();
      renderCategories();
      restoreLastChannel();
      if (currentServer.includes("acortador.vip")) checkAccountExpiryFromChannels();
      showSpinner(false);
      return true;
    }

    throw new Error("Rellena los datos de Xtream o usa una URL M3U.");
  } catch (error) {
    showSpinner(false);
    setLoginStatus(error.message || "Error al iniciar sesión.");
    startRemotePolling();
    return false;
  }
}

/********** AUTO-LOGIN **********/
function cancelLogin() {
  loginCancelled = true;
  showSpinner(false);
  setLoginStatus("Entrada automática cancelada. Pulsa Cargar Contenido.");
  startRemotePolling();
}

window.addEventListener("DOMContentLoaded", () => {
  detectDevice();
  showDeviceId();
  startRemotePolling();

  let saved = null;
  try {
    const raw = localStorage.getItem("xtream_user");
    if (raw) saved = JSON.parse(raw);
  } catch (e) {}
  if (!saved) return;

  try {
    if (saved.server && document.getElementById("serverUrl")) document.getElementById("serverUrl").value = saved.server;
    if (saved.username && saved.username !== "Invitado M3U" && document.getElementById("username")) {
      document.getElementById("username").value = saved.username;
    }
    if (saved.password && document.getElementById("password")) document.getElementById("password").value = saved.password;
    if (saved.m3uUrl && document.getElementById("m3uUrl")) document.getElementById("m3uUrl").value = saved.m3uUrl;
  } catch (e) {}

  const canAutoLogin = !!((saved.username && saved.password) || saved.m3uUrl);
  if (!canAutoLogin) return;

  // Se entra solo, pero el overlay lleva botón de cancelar: antes un fallo aquí
  // dejaba la pantalla bloqueada en "Descargando lista..." sin salida.
  setTimeout(() => {
    if (loginCancelled) return;
    performLoginAction(saved.server, saved.username, saved.password, saved.m3uUrl);
  }, 400);
});

window.addEventListener("resize", detectDevice);

const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (pollingInterval) clearInterval(pollingInterval);
    const serverUrl = document.getElementById("serverUrl") ? document.getElementById("serverUrl").value.trim() : "";
    const username = document.getElementById("username") ? document.getElementById("username").value.trim() : "";
    const password = document.getElementById("password") ? document.getElementById("password").value.trim() : "";
    const m3uUrl = document.getElementById("m3uUrl") ? document.getElementById("m3uUrl").value.trim() : "";
    performLoginAction(serverUrl, username, password, m3uUrl);
  });
}

async function fetchXtream(endpoint, params, serverOverride) {
  const targetServer = serverOverride || currentServer;
  const queryString = new URLSearchParams(params || {}).toString();
  const serverPart = targetServer ? "&server=" + encodeURIComponent(targetServer) : "";
  return await fetch(
    "xtream_proxy.php?endpoint=" + encodeURIComponent(endpoint) + serverPart + (queryString ? "&" + queryString : "")
  );
}

async function checkAccountExpiryFromChannels() {
  if (!channelsData || channelsData.length === 0) return;
  try {
    const firstChannelUrl = channelsData[0].url;
    const urlObj = new URL(firstChannelUrl);
    const segments = urlObj.pathname.split("/").filter((p) => p.length > 0);

    if (segments.length >= 3) {
      const realPassword = segments[segments.length - 2];
      const realUsername = segments[segments.length - 3];
      const realServer = urlObj.origin;

      const res = await fetchXtream("player_api.php", { username: realUsername, password: realPassword }, realServer);
      const data = await res.json();
      if (data && data.user_info) showAccountExpiry(data.user_info);
    }
  } catch (e) {}
}

function finishLogin(user) {
  if (document.activeElement) document.activeElement.blur();
  window.scrollTo(0, 0);
  showScreen("main");

  const headerUser = document.getElementById("headerUser");
  if (headerUser) headerUser.textContent = user.username;

  if (!user.isM3U && user.info && !(currentServer && currentServer.includes("acortador.vip"))) {
    showAccountExpiry(user.info);
  }

  generateSessionToken();
  startActivityMonitoring();

  // La guía llega después de la lista: nunca debe retrasar la entrada al player.
  setTimeout(() => {
    loadEPG();
  }, 1500);
}

function showAccountExpiry(info) {
  let expiryText = "";
  let color = "";

  if (!info || !info.exp_date || info.exp_date === "null") {
    expiryText = "";
  } else {
    const expDate = parseInt(info.exp_date, 10);
    if (isNaN(expDate) || expDate === 0) {
      expiryText = "🟢 Ilimitada";
      color = "#4ade80";
    } else {
      const now = Math.floor(Date.now() / 1000);
      const daysLeft = Math.ceil((expDate - now) / 86400);

      if (daysLeft < 0) {
        expiryText = "🔴 Caducada";
        color = "#ef4444";
      } else if (daysLeft <= 5) {
        expiryText = "🟠 " + daysLeft + " días";
        color = "#facc15";
      } else {
        expiryText = "🟢 " + daysLeft + " días";
        color = "#4ade80";
      }
    }
  }

  const pcExpiryEl = document.getElementById("accountExpiryLabel");
  if (pcExpiryEl) {
    pcExpiryEl.textContent = expiryText;
    pcExpiryEl.style.color = color;
  }
}

/********** ACTIVIDAD / HEARTBEAT **********/
function generateSessionToken() {
  const user = currentUser && currentUser.username ? currentUser.username : "user";
  sessionToken = user + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 11);
}

function startActivityMonitoring() {
  stopActivityMonitoring();
  if (!currentUser || currentUser.isM3U) return;
  if (!sessionToken) generateSessionToken();

  activityInterval = setInterval(() => {
    if (activeConnection) sendActivity();
  }, 15000);

  heartbeatInterval = setInterval(() => {
    sendHeartbeat();
  }, 20000);
}

function stopActivityMonitoring() {
  if (activityInterval) clearInterval(activityInterval);
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  activityInterval = null;
  heartbeatInterval = null;
}

async function sendActivity(action) {
  if (!currentUser || currentUser.isM3U) return;
  try {
    const body = { username: currentUser.username, action: action || "update" };
    if (action !== "stop" && activeConnection) {
      body.channel = activeConnection.channel;
      body.url = video ? video.getAttribute("data-active-url") || video.src : "";
    }
    await fetch("activity_api.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {}
}

async function sendHeartbeat() {
  if (!currentUser || currentUser.isM3U || !sessionToken) return;
  try {
    const res = await fetch("heartbeat.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: sessionToken,
        username: currentUser.username,
        is_playing: !!activeConnection && video && !video.paused,
        current_channel: activeConnection ? activeConnection.channel : null,
      }),
    });
    const data = await res.json();
    if (data.blocked || (data.valid === false && data.message === "Usuario bloqueado")) {
      showToast("Tu usuario ha sido bloqueado");
      doLogout();
      return;
    }
    if (data.stop_playback) {
      if (hls) {
        hls.destroy();
        hls = null;
      }
      if (mpegtsPlayer) {
        mpegtsPlayer.destroy();
        mpegtsPlayer = null;
      }
      if (video) video.src = "";
      activeConnection = null;
      showToast("Reproducción detenida por el administrador");
    }
  } catch (e) {}
}

function updateActivity(channel) {
  if (!currentUser || currentUser.isM3U) return;
  activeConnection = {
    user: currentUser.username,
    channel: channel.name,
    startTime: new Date(),
  };
  sendActivity();
}

/********** DESCARGA Y LECTURA DE EPG ASÍNCRONA **********/
function normalizeEpgKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(hd|fhd|uhd|4k|hevc|sd|tv)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Pide la guía ya digerida a epg_api.php. El XMLTV completo se parsea en el
 * servidor: hacerlo aquí congelaba la interfaz durante segundos.
 */
async function loadEPG() {
  try {
    const res = await fetch(EPG_URL, { cache: "no-store" });
    if (!res.ok) {
      epgLastStatus = "HTTP " + res.status + (res.status === 404 ? " (falta epg_api.php en el servidor)" : "");
      scheduleEpgRetry();
      return false;
    }

    const data = await res.json();
    const ids = data && data.c ? Object.keys(data.c) : [];
    if (!ids.length) {
      // La primera visita deja al servidor generando la caché; se reintenta.
      epgLastStatus = "vacía, el servidor aún la está generando";
      scheduleEpgRetry();
      return false;
    }

    const index = {};
    ids.forEach((id) => {
      const list = data.c[id];
      if (!list || !list.length) return;
      index[id] = list.map((p) => ({
        startTs: p[0] * 1000,
        stopTs: p[1] * 1000,
        title: p[2] || "Sin título",
      }));
    });

    epgIndex = index;
    epgAliases = data.a || {};
    epgResolvedIds = {};
    epgLoadedAt = Date.now();
    epgRetryIndex = 0;
    epgLastStatus = ids.length + " canales";

    refreshVisibleChannelEPG();
    refreshPlayerEPG();
    renderEpgTimeline();
    scheduleEpgTimers();
    return true;
  } catch (e) {
    epgLastStatus = "error de red o JSON inválido";
    scheduleEpgRetry();
    return false;
  }
}

/**
 * Generar la guía la primera vez lleva minutos (descarga y parseo del XMLTV),
 * así que el primer intento casi siempre llega en vacío y hay que insistir.
 */
function scheduleEpgRetry() {
  if (epgRetryIndex >= EPG_RETRY_DELAYS.length) return;
  const delay = EPG_RETRY_DELAYS[epgRetryIndex];
  epgRetryIndex++;
  clearTimeout(epgRetryTimer);
  epgRetryTimer = setTimeout(() => {
    loadEPG();
  }, delay);
}

function scheduleEpgTimers() {
  clearInterval(epgRefreshTimer);
  epgRefreshTimer = setInterval(() => {
    refreshVisibleChannelEPG();
    refreshPlayerEPG();
    renderEpgTimeline();
  }, 60 * 1000);

  clearInterval(epgReloadTimer);
  epgReloadTimer = setInterval(() => {
    loadEPG();
  }, 30 * 60 * 1000);
}

function hasEPG() {
  return epgLoadedAt > 0;
}

function resolveEpgChannelId(channel) {
  if (!channel) return "";
  if (Object.prototype.hasOwnProperty.call(epgResolvedIds, channel.id)) {
    return epgResolvedIds[channel.id];
  }

  let found = "";
  const candidates = [channel.tvgId, channel.name, (channel.name || "").replace(/\s+/g, "")];
  for (let i = 0; i < candidates.length && !found; i++) {
    if (candidates[i] && epgIndex[candidates[i]]) {
      found = candidates[i];
      break;
    }
    const key = normalizeEpgKey(candidates[i]);
    if (key && epgAliases[key]) found = epgAliases[key];
  }

  // Último recurso: comparar por trozos del nombre ("La 1 HD" → "la1").
  if (!found) {
    const nameKey = normalizeEpgKey(channel.name);
    if (nameKey && nameKey.length >= 5) {
      const keys = Object.keys(epgAliases);
      for (let i = 0; i < keys.length; i++) {
        if (keys[i].indexOf(nameKey) !== -1 || nameKey.indexOf(keys[i]) !== -1) {
          found = epgAliases[keys[i]];
          break;
        }
      }
    }
  }

  epgResolvedIds[channel.id] = found;
  return found;
}

function getNowNext(channel) {
  const empty = { now: null, next: null };
  if (!hasEPG()) return empty;
  const id = resolveEpgChannelId(channel);
  const list = (id && epgIndex[id]) || [];
  if (!list.length) return empty;
  const now = Date.now();
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.startTs <= now && now < p.stopTs) {
      return { now: p, next: list[i + 1] || null };
    }
    if (p.startTs > now) {
      return { now: null, next: p };
    }
  }
  return empty;
}

function formatEpgLine(prog) {
  if (!prog) return "";
  return formatTime(new Date(prog.startTs)) + " " + prog.title;
}

function channelEpgLabel(channel) {
  const info = getNowNext(channel);
  if (info.now) return formatEpgLine(info.now);
  if (info.next) return formatEpgLine(info.next);
  return "";
}

function refreshPlayerEPG() {
  if (!epgNowEl) return;
  const channel = currentlyPlayingId ? channelById.get(currentlyPlayingId) : null;
  if (!channel) return;

  if (!hasEPG()) {
    epgNowEl.textContent = "Cargando guía...";
    if (epgNextEl) epgNextEl.textContent = "--:--";
    return;
  }

  const info = getNowNext(channel);
  if (info.now) {
    epgNowEl.textContent = formatEpgLine(info.now);
    if (epgNextEl) epgNextEl.textContent = info.next ? formatEpgLine(info.next) : "--:--";
  } else if (info.next) {
    epgNowEl.textContent = "--:--";
    if (epgNextEl) epgNextEl.textContent = formatEpgLine(info.next);
  } else {
    epgNowEl.textContent = "Sin información en la guía";
    if (epgNextEl) epgNextEl.textContent = "--:--";
  }
}

function refreshVisibleChannelEPG() {
  if (!channelsContainer || !hasEPG()) return;
  channelsContainer.querySelectorAll(".channel-item").forEach((item) => {
    const epgEl = item.querySelector(".channel-epg");
    if (!epgEl) return;
    const channel = channelById.get(item.dataset.id);
    if (!channel) return;
    epgEl.textContent = channelEpgLabel(channel);
  });
}

function formatTime(date) {
  if (!date || isNaN(date.getTime())) return "--:--";
  return date.getHours().toString().padStart(2, "0") + ":" + date.getMinutes().toString().padStart(2, "0");
}

/********** CARGAR Y PARSEAR M3U **********/
async function loadM3UFromXtream() {
  const response = await fetchXtream("get.php", {
    username: currentUser.username,
    password: currentUser.password,
    type: "m3u_plus",
    output: "ts",
  });
  const m3uContent = await response.text();
  const trimmed = (m3uContent || "").trim();
  if (!trimmed || trimmed.charAt(0) === "{" || /<!DOCTYPE|<html/i.test(trimmed)) {
    throw new Error("No se pudo descargar la lista M3U");
  }
  parseM3U(m3uContent);
  if (!channelsData.length) {
    throw new Error("La lista no contiene canales");
  }
}

function isStreamUrl(line) {
  return /^(https?|rtmp[es]?|rtsps?|udp|rtp):\/\//i.test(line);
}

function parseM3U(content) {
  const started = Date.now();
  const raw = String(content || "");
  const lines = raw.split(/\r\n|\n|\r/);
  const channels = [];
  const categories = {};
  let currentChannel = null;
  let extinf = 0;
  let skippedNoUrl = 0;
  const skippedBadUrl = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().replace(/^["']|["']$/g, "");
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      if (currentChannel) skippedNoUrl++;
      extinf++;
      const groupMatch = line.match(/group-title="([^"]+)"/i);
      const nameMatch = line.match(/,(.+)$/);
      const tvgIdMatch = line.match(/tvg-id="([^"]+)"/i);
      const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
      const safeName = nameMatch ? nameMatch[1].trim() : "Canal";
      const category = groupMatch ? groupMatch[1] : "Sin categoría";
      const tvgId = tvgIdMatch ? tvgIdMatch[1] : "";
      const logo = logoMatch ? logoMatch[1].trim() : "";
      const idBase = (tvgId || "") + "|" + category + "|" + safeName + "|" + extinf;
      const stableId = "ch_" + idBase.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
      currentChannel = { name: safeName, category: category, tvgId: tvgId, logo: logo, id: stableId };
      continue;
    }

    if (line.charAt(0) === "#") continue;

    if (currentChannel && isStreamUrl(line)) {
      currentChannel.url = line;
      channels.push(currentChannel);
      if (!categories[currentChannel.category]) categories[currentChannel.category] = [];
      categories[currentChannel.category].push(currentChannel);
      currentChannel = null;
    } else if (currentChannel) {
      if (skippedBadUrl.length < 12) skippedBadUrl.push(line.slice(0, 180));
      skippedNoUrl++;
      currentChannel = null;
    }
  }
  if (currentChannel) skippedNoUrl++;

  channelsData = channels;
  categoriesData = categories;
  channelById = new Map();
  channels.forEach((ch) => channelById.set(ch.id, ch));
  epgResolvedIds = {};
  lastParseDebug = {
    bytes: raw.length,
    lines: lines.length,
    extinf: extinf,
    parsed: channels.length,
    categories: Object.keys(categories).length,
    skipped: skippedNoUrl,
    skippedSamples: skippedBadUrl,
    ms: Date.now() - started,
    user: currentUser ? currentUser.username : "",
    mode: currentUser && currentUser.isM3U ? "m3u" : "xtream",
  };
}

function getPlaybackStats() {
  if (!video) return "  (sin reproductor)";

  const lines = [];
  const channel = currentlyPlayingId ? channelById.get(currentlyPlayingId) : null;
  lines.push("  canal: " + (channel ? channel.name : "-"));
  lines.push("  motor: " + (hls ? "hls.js" : mpegtsPlayer ? "mpegts.js" : "nativo"));
  lines.push("  resolucion: " + (video.videoWidth || 0) + "x" + (video.videoHeight || 0));

  let buffered = 0;
  try {
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.currentTime >= video.buffered.start(i) && video.currentTime <= video.buffered.end(i)) {
        buffered = video.buffered.end(i) - video.currentTime;
      }
    }
  } catch (e) {}
  lines.push("  buffer por delante: " + buffered.toFixed(1) + "s");

  try {
    if (video.getVideoPlaybackQuality) {
      const q = video.getVideoPlaybackQuality();
      lines.push("  fotogramas: " + q.totalVideoFrames + " (perdidos " + q.droppedVideoFrames + ")");
    }
  } catch (e) {}

  if (hls) {
    try {
      const level = hls.levels && hls.levels[hls.currentLevel];
      if (level) lines.push("  bitrate: " + Math.round(level.bitrate / 1000) + " kbps");
      lines.push("  pistas audio: " + ((hls.audioTracks && hls.audioTracks.length) || 0));
      lines.push("  pistas subs: " + ((hls.subtitleTracks && hls.subtitleTracks.length) || 0));
    } catch (e) {}
  }

  lines.push("  cortes en este canal: " + stallCount);
  lines.push("  reintentos: " + playbackRetries);
  lines.push("  buffer configurado: " + getBufferSeconds() + "s");
  lines.push("  ajuste imagen: " + FIT_MODES[getFitIndex()].value);
  lines.push("  chromecast: " + (castReady ? "listo" : "no disponible"));
  return lines.join("\n");
}

function getDebugReport() {
  const d = lastParseDebug || {};
  const catLines = Object.keys(categoriesData)
    .sort()
    .map((name) => "  - " + name + ": " + (categoriesData[name] || []).length)
    .join("\n");
  return [
    "StreamBox debug",
    "ua: " + (navigator.userAgent || ""),
    "size: " + window.innerWidth + "x" + window.innerHeight,
    "user: " + (d.user || "-") + " (" + (d.mode || "-") + ")",
    "m3u bytes: " + (d.bytes || 0),
    "lineas: " + (d.lines || 0),
    "#EXTINF: " + (d.extinf || 0),
    "canales pintados: " + (d.parsed || 0),
    "categorias: " + (d.categories || 0),
    "extinf sin url: " + (d.skipped || 0),
    "parse ms: " + (d.ms || 0),
    "buffer: " + getBufferSeconds() + "s",
    "epg estado: " + epgLastStatus,
    "epg canales: " + Object.keys(epgIndex).length,
    "epg alias: " + Object.keys(epgAliases).length,
    "epg cargada: " + (epgLoadedAt ? new Date(epgLoadedAt).toLocaleTimeString() : "no"),
    "epg intentos: " + epgRetryIndex,
    "-- reproduccion --",
    getPlaybackStats(),
    "muestras url raras:",
    d.skippedSamples && d.skippedSamples.length ? d.skippedSamples.join("\n") : "  (ninguna)",
    "canales por categoria:",
    catLines || "  (vacio)",
  ].join("\n");
}

let debugRefreshTimer = null;

/**
 * El panel flota sobre la interfaz y se puede arrastrar por su cabecera, así
 * que se puede mirar mientras se cambia de canal para ver qué pasa.
 */
function initDebugDrag() {
  const overlay = document.getElementById("debugOverlay");
  const header = document.getElementById("debugHeader");
  if (!overlay || !header) return;

  let drag = null;

  const start = (clientX, clientY) => {
    const rect = overlay.getBoundingClientRect();
    // Se pasa de anclaje derecho a izquierdo para poder moverlo libremente.
    overlay.style.right = "auto";
    overlay.style.left = rect.left + "px";
    overlay.style.top = rect.top + "px";
    overlay.style.width = rect.width + "px";
    drag = { dx: clientX - rect.left, dy: clientY - rect.top, w: rect.width, h: rect.height };
  };

  const move = (clientX, clientY) => {
    if (!drag) return;
    const maxLeft = Math.max(0, window.innerWidth - drag.w);
    const maxTop = Math.max(0, window.innerHeight - 40);
    overlay.style.left = Math.min(maxLeft, Math.max(0, clientX - drag.dx)) + "px";
    overlay.style.top = Math.min(maxTop, Math.max(0, clientY - drag.dy)) + "px";
  };

  header.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON") return;
    e.preventDefault();
    start(e.clientX, e.clientY);
  });
  document.addEventListener("mousemove", (e) => {
    if (drag) move(e.clientX, e.clientY);
  });
  document.addEventListener("mouseup", () => {
    drag = null;
  });

  header.addEventListener(
    "touchstart",
    (e) => {
      if (e.target.tagName === "BUTTON" || e.touches.length !== 1) return;
      start(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: true }
  );
  header.addEventListener(
    "touchmove",
    (e) => {
      if (!drag || e.touches.length !== 1) return;
      e.preventDefault();
      move(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: false }
  );
  header.addEventListener("touchend", () => {
    drag = null;
  });
}

initDebugDrag();

function setDebugOpen(open) {
  const overlay = document.getElementById("debugOverlay");
  const output = document.getElementById("debugOutput");
  if (!overlay || !output) return;
  clearInterval(debugRefreshTimer);
  debugRefreshTimer = null;

  if (open) {
    output.textContent = getDebugReport();
    overlay.classList.add("is-open");
    overlay.hidden = false;
    debugRefreshTimer = setInterval(() => {
      output.textContent = getDebugReport();
    }, 1000);
  } else {
    overlay.classList.remove("is-open");
    overlay.hidden = true;
  }
}

function noteDebugZero() {
  debugZeroCount++;
  clearTimeout(debugZeroTimer);
  debugZeroTimer = setTimeout(() => {
    debugZeroCount = 0;
  }, 1600);
  if (debugZeroCount >= 5) {
    debugZeroCount = 0;
    setDebugOpen(true);
    showToast("Modo debug");
  }
}

/********** RENDERIZAR INTERFAZ **********/
function renderCategories() {
  if (categoriesContainer) categoriesContainer.innerHTML = "";
  const categoryNames = Object.keys(categoriesData).sort();

  categoryNames.forEach((catName) => {
    if (categoriesContainer) {
      const btn = document.createElement("button");
      btn.className = "category-btn";
      btn.dataset.category = catName;
      btn.textContent = catName;
      btn.title = catName;
      btn.addEventListener("click", () => selectCategory(catName));
      categoriesContainer.appendChild(btn);
    }
  });

  if (categoryNames.length > 0) selectCategory(categoryNames[0]);
}

function selectCategory(categoryName) {
  currentCategory = categoryName;
  document.querySelectorAll(".category-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.category === categoryName);
  });

  const channelsToShow = categoriesData[categoryName] || [];

  renderChannels(channelsToShow);
  if (channelColumnTitle) channelColumnTitle.textContent = categoryName;
  if (currentFocus) currentFocus.col = 0;
}

function channelInitials(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2);
  return words[0].charAt(0) + words[1].charAt(0);
}

function buildChannelThumb(channel) {
  const fallback = document.createElement("div");
  fallback.className = "channel-logo-fallback";
  fallback.textContent = channelInitials(channel.name);
  if (!channel.logo) return fallback;

  const img = document.createElement("img");
  img.className = "channel-logo";
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = "";
  // Muchos logos apuntan a http y el navegador los bloquea al servir la web
  // por https; otros simplemente ya no existen. En ambos casos, iniciales.
  img.addEventListener(
    "error",
    () => {
      if (img.parentNode) img.parentNode.replaceChild(fallback, img);
    },
    { once: true }
  );
  img.src = channel.logo;
  return img;
}

function renderChannels(channels) {
  if (channelsContainer) channelsContainer.innerHTML = "";

  channels.forEach((channel) => {
    const channelDiv = document.createElement("div");
    channelDiv.className = "channel-item";
    channelDiv.dataset.id = channel.id;
    channelDiv.appendChild(buildChannelThumb(channel));

    const info = document.createElement("div");
    info.className = "channel-info";
    const nameEl = document.createElement("div");
    nameEl.className = "channel-name";
    nameEl.textContent = channel.name;
    info.appendChild(nameEl);
    channelDiv.appendChild(info);

    channelDiv.addEventListener("click", () => {
      if (currentlyPlayingId === channel.id) toggleFullscreen();
      else selectChannel(channel);
    });

    if (channelsContainer) channelsContainer.appendChild(channelDiv);
  });
}

/********** MOTOR DE REPRODUCCIÓN **********/
const PLAYBACK_RETRY_DELAYS = [2000, 5000, 10000];
let currentChannelRef = null;
let playbackRetries = 0;
let playbackRetryTimer = null;
let hlsRecoveries = 0;
let stallCount = 0;

function clearPlaybackRetry() {
  clearTimeout(playbackRetryTimer);
  playbackRetryTimer = null;
}

/**
 * En IPTV los cortes son constantes, así que un fallo no debe dejar la pantalla
 * en negro: se reintenta el mismo canal antes de darse por vencido.
 */
function playbackLooksAlive() {
  // readyState >= 3 significa que hay fotogramas listos para seguir pintando.
  return !!video && !video.paused && !video.ended && video.readyState >= 3;
}

function handlePlaybackFailure() {
  if (teardownInProgress || !currentChannelRef) return;
  // Un reintento ya en cola hace de freno: sin esto, una ráfaga de avisos de
  // error encadenaría varios reinicios seguidos del mismo canal.
  if (playbackRetryTimer) return;
  // mpegts.js y hls.js también avisan de fallos de los que se recuperan solos.
  // Si el vídeo sigue avanzando, reiniciar cortaría una emisión que va bien.
  if (playbackLooksAlive()) return;

  showVideoSpinner(false);

  if (playbackRetries >= PLAYBACK_RETRY_DELAYS.length) {
    showToast("No se pudo reproducir el canal");
    return;
  }

  const delay = PLAYBACK_RETRY_DELAYS[playbackRetries];
  playbackRetries++;
  showToast("Reconectando (" + playbackRetries + "/" + PLAYBACK_RETRY_DELAYS.length + ")...");

  const channel = currentChannelRef;
  clearPlaybackRetry();
  playbackRetryTimer = setTimeout(() => {
    playbackRetryTimer = null;
    if (playbackLooksAlive()) return;
    if (currentChannelRef && currentChannelRef.id === channel.id) startPlayback(channel);
  }, delay);
}

function playChannel(channel) {
  currentChannelRef = channel;
  playbackRetries = 0;
  stallCount = 0;
  clearPlaybackRetry();
  rememberLastChannel(channel);
  startPlayback(channel);
}

function startPlayback(channel) {
  if (!video) return;
  showVideoSpinner(true);
  stopPlayback();
  updateActivity(channel);
  resetTrackSelectors();
  hlsRecoveries = 0;

  const currentDomain = window.location.origin + window.location.pathname.replace("index.html", "");
  const originalUrl = channel.url;
  const isTs = /\.ts(\?|$)/i.test(originalUrl) || originalUrl.toLowerCase().includes(".ts");
  const isM3u8 = /\.m3u8(\?|$)/i.test(originalUrl) || originalUrl.toLowerCase().includes(".m3u8");
  const bufferSec = getBufferSeconds();

  const tryAutoPlay = () => {
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => showVideoSpinner(false))
        .catch((err) => {
          showVideoSpinner(false);
          // Al reanudar el último canal no hay gesto previo del usuario y el
          // navegador bloquea el arranque automático.
          if (err && err.name === "NotAllowedError") showToast("Pulsa ▶ para empezar");
        });
    } else {
      showVideoSpinner(false);
    }
  };

  const mseSupported = window.mpegts && mpegts.getFeatureList().mseLivePlayback;

  if (isTs && mseSupported) {
    const proxiedTsUrl = currentDomain + "stream.php?url=" + encodeURIComponent(originalUrl);
    video.setAttribute("data-active-url", proxiedTsUrl);
    mpegtsPlayer = mpegts.createPlayer(
      { type: "mse", isLive: true, url: proxiedTsUrl },
      {
        enableWorker: true,
        enableStashBuffer: true,
        // Este colchón es lo que absorbe los altibajos de la conexión. Bajarlo
        // acelera el arranque pero deja la reproducción pegada al borde del
        // directo y cortándose, así que manda la estabilidad.
        stashInitialSize: Math.max(384 * 1024, bufferSec * 48 * 1024),
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: Math.max(3, Math.min(bufferSec, 20)),
        liveBufferLatencyMinRemain: 1,
      }
    );
    mpegtsPlayer.attachMediaElement(video);
    mpegtsPlayer.load();
    const p = mpegtsPlayer.play();
    if (p !== undefined) {
      p.then(() => showVideoSpinner(false)).catch(() => showVideoSpinner(false));
    } else {
      showVideoSpinner(false);
    }
    mpegtsPlayer.on(mpegts.Events.ERROR, handlePlaybackFailure);
  } else if (isTs && !mseSupported) {
    const iosUrl = originalUrl.replace(/\.ts(\?|$)/i, ".m3u8$1");
    video.setAttribute("data-active-url", iosUrl);
    video.src = iosUrl;
    video.addEventListener("loadedmetadata", tryAutoPlay, { once: true });
  } else if (isM3u8) {
    video.setAttribute("data-active-url", originalUrl);
    if (window.Hls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: bufferSec,
        maxMaxBufferLength: bufferSec * 2,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: Math.max(5, Math.ceil(bufferSec / 2)),
        backBufferLength: 0,
      });
      hls.loadSource(originalUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        tryAutoPlay();
        refreshTrackSelectors();
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, refreshTrackSelectors);
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, refreshTrackSelectors);
      hls.on(Hls.Events.ERROR, (e, data) => {
        if (!data || !data.fatal) return;
        // Los fallos de red y de medio tienen recuperación propia en hls.js.
        // Se limita el número de intentos para no quedarse en bucle si el
        // origen está caído; a partir de ahí se reinicia el canal entero.
        if (hlsRecoveries < 3) {
          hlsRecoveries++;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            try {
              hls.startLoad();
              return;
            } catch (err) {}
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            try {
              hls.recoverMediaError();
              return;
            } catch (err) {}
          }
        }
        handlePlaybackFailure();
      });
    } else {
      video.src = originalUrl;
      tryAutoPlay();
    }
  } else {
    video.setAttribute("data-active-url", originalUrl);
    video.src = originalUrl;
    tryAutoPlay();
  }
}

/********** ESTADO DEL <video> **********/
if (video) {
  video.preload = "auto";

  video.addEventListener("playing", () => {
    playbackRetries = 0;
    hlsRecoveries = 0;
    clearPlaybackRetry();
    showVideoSpinner(false);
  });
  // En directo los microcortes de menos de un segundo son constantes. Tapar el
  // vídeo cada vez hace parecer que va peor de lo que va, así que el aviso solo
  // aparece si la parada dura de verdad.
  video.addEventListener("waiting", () => {
    if (teardownInProgress) return;
    stallCount++;
    if (bufferingSpinnerTimer) return;
    bufferingSpinnerTimer = setTimeout(() => showVideoSpinner(true), 900);
  });
  video.addEventListener("canplay", () => {
    clearTimeout(bufferingSpinnerTimer);
    bufferingSpinnerTimer = null;
  });
  video.addEventListener("error", handlePlaybackFailure);
  video.addEventListener("ended", handlePlaybackFailure);
}

/********** ÚLTIMO CANAL **********/
const LAST_CHANNEL_KEY = "streambox_last_channel";

function rememberLastChannel(channel) {
  try {
    localStorage.setItem(LAST_CHANNEL_KEY, JSON.stringify({ id: channel.id, cat: channel.category }));
  } catch (e) {}
}

function selectChannel(channel) {
  if (!channel) return;
  currentlyPlayingId = channel.id;
  document.querySelectorAll(".channel-item").forEach((item) => {
    item.classList.toggle("playing", item.dataset.id === channel.id);
  });
  playChannel(channel);
  refreshPlayerEPG();
  renderEpgTimeline();
}

function restoreLastChannel() {
  try {
    const raw = localStorage.getItem(LAST_CHANNEL_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    const channel = saved && saved.id ? channelById.get(saved.id) : null;
    if (!channel) return false;

    const category = saved.cat && categoriesData[saved.cat] ? saved.cat : channel.category;
    if (category && categoriesData[category]) selectCategory(category);
    selectChannel(channel);

    const el = channelsContainer ? channelsContainer.querySelector(".channel-item.playing") : null;
    if (el) el.scrollIntoView({ block: "nearest" });
    return true;
  } catch (e) {
    return false;
  }
}

/********** PANTALLA COMPLETA **********/
function isFullscreen() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    (video && video.webkitDisplayingFullscreen)
  );
}

function enterFullscreen() {
  if (!video) return;
  const target = video.parentElement || video;
  try {
    if (target.requestFullscreen) target.requestFullscreen();
    else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  } catch (e) {}
}

function exitFullscreen() {
  try {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    else if (video && video.webkitExitFullscreen) video.webkitExitFullscreen();
  } catch (e) {}
}

function toggleFullscreen() {
  if (isFullscreen()) exitFullscreen();
  else enterFullscreen();
}

// Girar el móvil a horizontal entra a pantalla completa. Algunos navegadores
// exigen un gesto del usuario y lo rechazan; por eso va en try/catch silencioso.
function handleOrientationChange() {
  if (!document.body.classList.contains("is-mobile")) return;
  const landscape = window.matchMedia("(orientation: landscape)").matches;
  if (landscape && currentlyPlayingId && !isFullscreen()) enterFullscreen();
  else if (!landscape && isFullscreen()) exitFullscreen();
}

window.addEventListener("orientationchange", () => setTimeout(handleOrientationChange, 250));

/********** SALTO EN EL TIEMPO **********/
function seekBy(seconds) {
  if (!video) return false;
  try {
    if (!video.seekable || !video.seekable.length) return false;
    const start = video.seekable.start(0);
    const end = video.seekable.end(video.seekable.length - 1);
    if (end - start < 5) return false;
    video.currentTime = Math.min(end, Math.max(start, video.currentTime + seconds));
    showToast((seconds > 0 ? "+" : "") + seconds + "s");
    return true;
  } catch (e) {
    return false;
  }
}

/********** AJUSTE DE IMAGEN **********/
const FIT_KEY = "streambox_fit";
const FIT_MODES = [
  { value: "contain", label: "Ajustar (sin recortar)" },
  { value: "cover", label: "Rellenar (recorta)" },
  { value: "fill", label: "Estirar" },
];

function getFitIndex() {
  const stored = localStorage.getItem(FIT_KEY);
  const i = FIT_MODES.findIndex((m) => m.value === stored);
  return i < 0 ? 0 : i;
}

function applyFit(index) {
  const mode = FIT_MODES[index % FIT_MODES.length];
  if (video) video.style.objectFit = mode.value;
  localStorage.setItem(FIT_KEY, mode.value);
  return mode;
}

const aspectBtn = document.getElementById("aspectBtn");
if (aspectBtn) {
  aspectBtn.addEventListener("click", () => {
    const next = (getFitIndex() + 1) % FIT_MODES.length;
    showToast(applyFit(next).label);
  });
}
applyFit(getFitIndex());

/********** PISTAS DE AUDIO Y SUBTÍTULOS **********/
const audioTrackWrap = document.getElementById("audioTrackWrap");
const audioTrackSelect = document.getElementById("audioTrackSelect");
const subtitleTrackWrap = document.getElementById("subtitleTrackWrap");
const subtitleTrackSelect = document.getElementById("subtitleTrackSelect");

function resetTrackSelectors() {
  if (audioTrackWrap) audioTrackWrap.hidden = true;
  if (subtitleTrackWrap) subtitleTrackWrap.hidden = true;
  if (audioTrackSelect) audioTrackSelect.innerHTML = "";
  if (subtitleTrackSelect) subtitleTrackSelect.innerHTML = "";
}

function trackLabel(track, index) {
  return track.name || track.label || track.lang || track.language || "Pista " + (index + 1);
}

function fillSelect(select, options, selectedValue) {
  if (!select) return;
  select.innerHTML = "";
  options.forEach((opt) => {
    const el = document.createElement("option");
    el.value = String(opt.value);
    el.textContent = opt.label;
    if (String(opt.value) === String(selectedValue)) el.selected = true;
    select.appendChild(el);
  });
}

function refreshTrackSelectors() {
  if (hls && hls.audioTracks && hls.audioTracks.length > 1) {
    fillSelect(
      audioTrackSelect,
      hls.audioTracks.map((t, i) => ({ value: i, label: trackLabel(t, i) })),
      hls.audioTrack
    );
    if (audioTrackWrap) audioTrackWrap.hidden = false;
  } else if (audioTrackWrap) {
    audioTrackWrap.hidden = true;
  }

  const subs = (hls && hls.subtitleTracks) || [];
  if (subs.length) {
    const options = [{ value: -1, label: "Desactivados" }].concat(
      subs.map((t, i) => ({ value: i, label: trackLabel(t, i) }))
    );
    fillSelect(subtitleTrackSelect, options, hls.subtitleTrack);
    if (subtitleTrackWrap) subtitleTrackWrap.hidden = false;
  } else if (subtitleTrackWrap) {
    subtitleTrackWrap.hidden = true;
  }
}

if (audioTrackSelect) {
  audioTrackSelect.addEventListener("change", () => {
    if (hls) hls.audioTrack = parseInt(audioTrackSelect.value, 10);
  });
}
if (subtitleTrackSelect) {
  subtitleTrackSelect.addEventListener("change", () => {
    if (hls) hls.subtitleTrack = parseInt(subtitleTrackSelect.value, 10);
  });
}

/********** PICTURE-IN-PICTURE Y AIRPLAY **********/
const pipBtn = document.getElementById("pipBtn");
if (pipBtn && document.pictureInPictureEnabled) {
  pipBtn.hidden = false;
  pipBtn.addEventListener("click", async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch (e) {
      showToast("Picture-in-Picture no disponible");
    }
  });
}

const airplayBtn = document.getElementById("airplayBtn");
if (airplayBtn && video && window.WebKitPlaybackTargetAvailabilityEvent) {
  video.addEventListener("webkitplaybacktargetavailabilitychanged", (e) => {
    airplayBtn.hidden = e.availability !== "available";
  });
  airplayBtn.addEventListener("click", () => {
    try {
      video.webkitShowPlaybackTargetPicker();
    } catch (err) {}
  });
}

/********** CHROMECAST **********/
const castButton = document.getElementById("castButton");
let castReady = false;

function setupCast() {
  if (castReady) return true;
  if (!window.cast || !window.cast.framework || !window.chrome || !chrome.cast) return false;
  try {
    cast.framework.CastContext.getInstance().setOptions({
      receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    });
    castReady = true;
    if (castButton) castButton.hidden = false;
    return true;
  } catch (e) {
    return false;
  }
}

window.__onGCastApiAvailable = function (isAvailable) {
  if (isAvailable) setupCast();
};

// El script de Google puede haberse cargado antes que este archivo, en cuyo
// caso el callback de arriba ya no se llama: se comprueba unas cuantas veces.
let castChecks = 0;
const castPoll = setInterval(() => {
  castChecks++;
  if (setupCast() || castChecks > 20) clearInterval(castPoll);
}, 500);

function castCurrentChannel() {
  if (!setupCast()) {
    showToast("Chromecast no disponible en este navegador");
    return;
  }
  const url = video ? video.getAttribute("data-active-url") : "";
  if (!url) {
    showToast("Elige un canal antes de enviarlo");
    return;
  }

  const context = cast.framework.CastContext.getInstance();
  context
    .requestSession()
    .then(() => {
      const session = context.getCurrentSession();
      if (!session) throw new Error("sin sesión");

      const isHls = url.indexOf(".m3u8") !== -1;
      const mediaInfo = new chrome.cast.media.MediaInfo(url, isHls ? "application/x-mpegURL" : "video/mp2t");
      mediaInfo.streamType = chrome.cast.media.StreamType.LIVE;
      const channel = currentlyPlayingId ? channelById.get(currentlyPlayingId) : null;
      const metadata = new chrome.cast.media.GenericMediaMetadata();
      metadata.title = channel ? channel.name : "StreamBox IPTV";
      mediaInfo.metadata = metadata;

      return session.loadMedia(new chrome.cast.media.LoadRequest(mediaInfo));
    })
    .then(() => showToast("Enviado a Chromecast"))
    .catch(() => showToast("No se pudo enviar a Chromecast"));
}

if (castButton) castButton.addEventListener("click", castCurrentChannel);

/********** PARRILLA EPG BAJO EL VÍDEO **********/
function renderEpgTimeline() {
  const box = document.getElementById("epgTimeline");
  const title = document.getElementById("epgTimelineTitle");
  if (!box) return;

  const setEmpty = (message) => {
    box.innerHTML = "";
    const p = document.createElement("div");
    p.className = "epg-timeline-empty";
    p.textContent = message;
    box.appendChild(p);
  };

  const channel = currentlyPlayingId ? channelById.get(currentlyPlayingId) : null;
  if (title) title.textContent = channel ? "Guía · " + channel.name : "Guía del canal";

  if (!channel) return setEmpty("Elige un canal para ver su guía.");
  if (!hasEPG()) return setEmpty("Cargando guía...");

  const id = resolveEpgChannelId(channel);
  const list = (id && epgIndex[id]) || [];
  if (!list.length) return setEmpty("Sin guía para este canal.");

  box.innerHTML = "";
  const now = Date.now();
  let nowSlot = null;

  list.forEach((p) => {
    const slot = document.createElement("div");
    slot.className = "epg-slot";

    const minutes = Math.max(10, Math.round((p.stopTs - p.startTs) / 60000));
    slot.style.width = Math.min(280, Math.max(90, minutes * 3)) + "px";
    if (p.stopTs <= now) slot.classList.add("is-past");

    const time = document.createElement("div");
    time.className = "epg-slot-time";
    time.textContent = formatTime(new Date(p.startTs)) + " - " + formatTime(new Date(p.stopTs));

    const name = document.createElement("div");
    name.className = "epg-slot-title";
    name.textContent = p.title;
    name.title = p.title;

    slot.appendChild(time);
    slot.appendChild(name);

    if (p.startTs <= now && now < p.stopTs) {
      slot.classList.add("is-now");
      const progress = document.createElement("div");
      progress.className = "epg-slot-progress";
      progress.style.width = Math.round(((now - p.startTs) / (p.stopTs - p.startTs)) * 100) + "%";
      slot.appendChild(progress);
      nowSlot = slot;
    }

    box.appendChild(slot);
  });

  // scrollIntoView movería también la página, así que se ajusta el scroll
  // horizontal de la propia parrilla.
  if (nowSlot) box.scrollLeft = Math.max(0, nowSlot.offsetLeft - box.offsetLeft - 8);
}

/********** GESTOS TÁCTILES: brillo a la izquierda, volumen a la derecha **********/
const BRIGHTNESS_KEY = "streambox_brightness";
const BRIGHTNESS_MIN = 0.25;
const BRIGHTNESS_MAX = 1.6;
const GESTURE_THRESHOLD = 10;

const videoWrapper = document.querySelector(".video-wrapper");
const gestureHint = document.getElementById("gestureHint");
const gestureIcon = document.getElementById("gestureIcon");
const gestureFill = document.getElementById("gestureFill");
const gestureValue = document.getElementById("gestureValue");

let gesture = null;
let gestureHideTimer = null;
let volumeLockWarned = false;
let lastTapAt = 0;
let lastTapX = 0;

// Doble toque: laterales para saltar, centro para pantalla completa.
function handleDoubleTap(clientX) {
  if (!videoWrapper) return;
  const rect = videoWrapper.getBoundingClientRect();
  if (!rect.width) return;
  const rel = (clientX - rect.left) / rect.width;

  if (rel < 0.33) {
    if (!seekBy(-15)) showToast("El directo no permite retroceder");
  } else if (rel > 0.67) {
    if (!seekBy(15)) showToast("El directo no permite avanzar");
  } else {
    toggleFullscreen();
  }
}

function getBrightness() {
  const stored = parseFloat(localStorage.getItem(BRIGHTNESS_KEY));
  if (isNaN(stored)) return 1;
  return Math.min(BRIGHTNESS_MAX, Math.max(BRIGHTNESS_MIN, stored));
}

function applyBrightness(value) {
  const v = Math.min(BRIGHTNESS_MAX, Math.max(BRIGHTNESS_MIN, value));
  // El navegador no puede tocar el brillo real de la pantalla, así que se
  // simula con un filtro sobre el vídeo.
  if (video) video.style.filter = v === 1 ? "" : "brightness(" + v.toFixed(2) + ")";
  localStorage.setItem(BRIGHTNESS_KEY, String(v));
  return v;
}

function showGestureHint(icon, ratio) {
  if (!gestureHint) return;
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  if (gestureIcon) gestureIcon.textContent = icon;
  if (gestureFill) gestureFill.style.width = pct + "%";
  if (gestureValue) gestureValue.textContent = pct + "%";
  gestureHint.hidden = false;
  gestureHint.classList.add("is-visible");
  clearTimeout(gestureHideTimer);
}

function hideGestureHint(delay) {
  clearTimeout(gestureHideTimer);
  gestureHideTimer = setTimeout(() => {
    if (!gestureHint) return;
    gestureHint.classList.remove("is-visible");
    gestureHint.hidden = true;
  }, delay || 700);
}

function initPlayerGestures() {
  if (!videoWrapper || !video) return;

  videoWrapper.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) {
        gesture = null;
        return;
      }
      const touch = e.touches[0];
      const rect = videoWrapper.getBoundingClientRect();
      if (!rect.height) return;

      gesture = {
        x: touch.clientX,
        y: touch.clientY,
        height: rect.height,
        side: touch.clientX - rect.left < rect.width / 2 ? "brightness" : "volume",
        startBrightness: getBrightness(),
        startVolume: video.volume,
        active: false,
      };
    },
    { passive: true }
  );

  videoWrapper.addEventListener(
    "touchmove",
    (e) => {
      if (!gesture || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const dx = touch.clientX - gesture.x;
      const dy = gesture.y - touch.clientY;

      // Solo se captura el gesto si es claramente vertical; así los toques y la
      // barra de controles nativa siguen funcionando.
      if (!gesture.active) {
        if (Math.abs(dy) < GESTURE_THRESHOLD || Math.abs(dy) <= Math.abs(dx)) return;
        gesture.active = true;
      }

      e.preventDefault();
      const ratio = dy / gesture.height;

      if (gesture.side === "brightness") {
        const range = BRIGHTNESS_MAX - BRIGHTNESS_MIN;
        const next = applyBrightness(gesture.startBrightness + ratio * range);
        showGestureHint("☀", (next - BRIGHTNESS_MIN) / range);
        return;
      }

      const target = Math.min(1, Math.max(0, gesture.startVolume + ratio));
      try {
        video.volume = target;
        if (target > 0) video.muted = false;
      } catch (err) {}

      // iOS no permite cambiar el volumen por código: se avisa en vez de mentir
      // con un indicador que no corresponde a nada.
      if (Math.abs(video.volume - target) > 0.05) {
        if (!volumeLockWarned) {
          volumeLockWarned = true;
          showToast("En iPhone y iPad el volumen se cambia con los botones del dispositivo");
        }
        hideGestureHint(0);
        return;
      }

      showGestureHint(video.volume === 0 ? "🔇" : "🔊", video.volume);
    },
    { passive: false }
  );

  const onTouchEnd = (e) => {
    const start = gesture;
    const wasSwipe = !!(start && start.active);
    gesture = null;

    if (wasSwipe) {
      hideGestureHint(700);
      return;
    }
    if (!start || !e.changedTouches || !e.changedTouches.length) return;

    const touch = e.changedTouches[0];
    if (Math.abs(touch.clientX - start.x) > 20 || Math.abs(touch.clientY - start.y) > 20) return;

    const now = Date.now();
    if (now - lastTapAt < 320 && Math.abs(touch.clientX - lastTapX) < 60) {
      lastTapAt = 0;
      handleDoubleTap(touch.clientX);
      return;
    }
    lastTapAt = now;
    lastTapX = touch.clientX;
  };

  videoWrapper.addEventListener("touchend", onTouchEnd, { passive: true });
  videoWrapper.addEventListener("touchcancel", () => {
    if (gesture && gesture.active) hideGestureHint(700);
    gesture = null;
  }, { passive: true });
}

applyBrightness(getBrightness());
initPlayerGestures();

/********** SISTEMA DE BOTONES **********/
function doLogout() {
  sendActivity("stop");
  stopActivityMonitoring();
  clearInterval(epgRefreshTimer);
  clearInterval(epgReloadTimer);
  clearTimeout(epgRetryTimer);
  clearPlaybackRetry();
  currentChannelRef = null;
  currentlyPlayingId = null;
  localStorage.removeItem("xtream_user");
  stopPlayback();
  showVideoSpinner(false);
  currentUser = null;
  sessionToken = null;
  activeConnection = null;
  showScreen("login");
  startRemotePolling();
}

async function doRefresh() {
  if (!currentUser) return;
  const ok = await performLoginAction(
    currentUser.server,
    currentUser.username,
    currentUser.password,
    currentUser.m3uUrl
  );
  showToast(ok ? "Lista actualizada correctamente" : "Error al actualizar la lista");
}

const spinnerCancelBtn = document.getElementById("spinnerCancelBtn");
if (spinnerCancelBtn) spinnerCancelBtn.addEventListener("click", cancelLogin);

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) logoutBtn.addEventListener("click", doLogout);

const refreshBtn = document.getElementById("refreshBtn");
if (refreshBtn) refreshBtn.addEventListener("click", doRefresh);

const bufferSelect = document.getElementById("bufferSelect");
if (bufferSelect) {
  bufferSelect.value = String(getBufferSeconds());
  bufferSelect.addEventListener("change", () => {
    const n = setBufferSeconds(bufferSelect.value);
    showToast("Buffer: " + n + "s (al cambiar de canal)");
  });
}

window.addEventListener("pagehide", stopPlayback);

window.addEventListener("beforeunload", () => {
  if (currentUser && !currentUser.isM3U) {
    try {
      navigator.sendBeacon(
        "activity_api.php",
        new Blob([JSON.stringify({ username: currentUser.username, action: "stop" })], {
          type: "application/json",
        })
      );
    } catch (e) {}
  }
});

/********** NAVEGACIÓN SMART TV (MANDO COMPLETO) **********/
let loginFocusIndex = -1;
const loginElements = ["serverUrl", "username", "password", "m3uUrl", "loginSubmitBtn"];

const BACK_KEYS = ["Escape", "Backspace", "BrowserBack", "GoBack"];
// El botón Atrás de los mandos de Tizen y webOS llega con estos códigos.
const BACK_KEYCODES = [10009, 461];

function isTypingTarget(target) {
  return !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
}

// Al salir de pantalla completa el cursor vuelve a la lista, sobre el canal
// que se está viendo, para poder seguir zapeando con el mando.
function focusChannelList() {
  currentFocus.col = 1;
  const items = Array.from(document.querySelectorAll(".channel-item"));
  const playing = items.findIndex((el) => el.classList.contains("playing"));
  if (playing >= 0) currentFocus.row = playing;
  updateCursorVisuals();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0") {
    if (isTypingTarget(e.target)) return;
    noteDebugZero();
    return;
  }

  if (BACK_KEYS.includes(e.key) || BACK_KEYCODES.includes(e.keyCode)) {
    // Backspace dentro de un campo tiene que seguir borrando texto.
    if (e.key === "Backspace" && isTypingTarget(e.target)) return;
    if (isFullscreen()) {
      e.preventDefault();
      exitFullscreen();
      focusChannelList();
      return;
    }
    setDebugOpen(false);
    return;
  }

  if (e.key === " " || e.key === "MediaPlayPause" || e.key === "MediaPlay") {
    if (isTypingTarget(e.target) || !video) return;
    e.preventDefault();
    if (video.paused) video.play();
    else video.pause();
    return;
  }

  const validKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"];
  if (!validKeys.includes(e.key)) return;

  const fullscreen = isFullscreen();

  if (fullscreen || currentFocus.col === 2) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (fullscreen) {
        exitFullscreen();
        focusChannelList();
      } else {
        enterFullscreen();
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      video.volume = Math.min(1, video.volume + 0.1);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      video.volume = Math.max(0, video.volume - 0.1);
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      seekBy(15);
      return;
    }
    if (e.key === "ArrowLeft") {
      if (!fullscreen && currentFocus.col === 2) {
        currentFocus.col = 1;
        updateCursorVisuals();
        return;
      }
      e.preventDefault();
      seekBy(-15);
      return;
    }
    return;
  }

  const loginScreen = document.getElementById("loginScreen");

  if (loginScreen && loginScreen.style.display !== "none" && loginScreen.classList.contains("active")) {
    if (e.key !== "Enter") e.preventDefault();

    if (e.key === "ArrowDown") {
      loginFocusIndex = Math.min(loginFocusIndex + 1, loginElements.length - 1);
    } else if (e.key === "ArrowUp") {
      loginFocusIndex = Math.max(loginFocusIndex - 1, 0);
    } else if (e.key === "Enter") {
      if (loginFocusIndex >= 0) {
        document.getElementById(loginElements[loginFocusIndex]).focus();
        if (loginElements[loginFocusIndex] === "loginSubmitBtn") document.getElementById("loginSubmitBtn").click();
      }
      return;
    }
    if (loginFocusIndex >= 0) {
      document.getElementById(loginElements[loginFocusIndex]).focus();
    }
    return;
  }

  if (e.key !== "Enter") e.preventDefault();

  const categories = document.querySelectorAll(".category-btn");
  const channels = document.querySelectorAll(".channel-item");

  if (e.key === "ArrowRight") {
    if (currentFocus.col === 0 && channels.length > 0) {
      currentFocus.col = 1;
      currentFocus.row = 0;
    } else if (currentFocus.col === 1) {
      currentFocus.col = 2;
    }
  } else if (e.key === "ArrowLeft") {
    if (currentFocus.col === 1 && categories.length > 0) {
      currentFocus.col = 0;
      const activeIndex = Array.from(categories).findIndex((c) => c.classList.contains("active"));
      currentFocus.row = activeIndex >= 0 ? activeIndex : 0;
    }
  } else if (e.key === "ArrowDown") {
    if (currentFocus.col === 0 && currentFocus.row < categories.length - 1) currentFocus.row++;
    else if (currentFocus.col === 1 && currentFocus.row < channels.length - 1) currentFocus.row++;
  } else if (e.key === "ArrowUp") {
    if (currentFocus.col === 0 && currentFocus.row > 0) currentFocus.row--;
    else if (currentFocus.col === 1 && currentFocus.row > 0) currentFocus.row--;
  } else if (e.key === "Enter") {
    if (currentFocus.col === 0 && categories[currentFocus.row]) {
      currentFocus.col = 1;
      currentFocus.row = 0;
    } else if (currentFocus.col === 1 && channels[currentFocus.row]) {
      channels[currentFocus.row].click();
    }
  }
  updateCursorVisuals();
});

function updateCursorVisuals() {
  document.querySelectorAll(".category-btn, .channel-item").forEach((el) => el.classList.remove("cursor"));
  let target = null;
  if (currentFocus.col === 0) {
    target = document.querySelectorAll(".category-btn")[currentFocus.row];
  } else if (currentFocus.col === 1) {
    target = document.querySelectorAll(".channel-item")[currentFocus.row];
  } else if (currentFocus.col === 2) {
    video.style.outline = "3px solid #fbbf24";
  }
  if (currentFocus.col !== 2) video.style.outline = "none";
  if (target) {
    target.classList.add("cursor");
    target.scrollIntoView({ block: "nearest", behavior: "smooth" });

    if (currentFocus.col === 0) {
      selectCategory(target.dataset.category);
    }
  }
}

const debugCopyBtn = document.getElementById("debugCopyBtn");
if (debugCopyBtn) {
  debugCopyBtn.addEventListener("click", async () => {
    const text = getDebugReport();
    try {
      await navigator.clipboard.writeText(text);
      showToast("Debug copiado");
    } catch (e) {
      showToast("No se pudo copiar");
    }
  });
}
const debugCloseBtn = document.getElementById("debugCloseBtn");
if (debugCloseBtn) debugCloseBtn.addEventListener("click", () => setDebugOpen(false));

const headerTitle = document.querySelector(".header-left h1");
if (headerTitle) {
  headerTitle.addEventListener("click", () => {
    debugTitleTaps++;
    clearTimeout(debugTitleTimer);
    debugTitleTimer = setTimeout(() => {
      debugTitleTaps = 0;
    }, 1600);
    if (debugTitleTaps >= 5) {
      debugTitleTaps = 0;
      setDebugOpen(true);
      showToast("Modo debug");
    }
  });
}
