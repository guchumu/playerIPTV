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

const EPG_URL = "epg_proxy.php";

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
let globalEPGData = [];
let pollingInterval = null;
let sessionToken = null;
let activityInterval = null;
let heartbeatInterval = null;
let activeConnection = null;

const video = document.getElementById("videoPlayer");
const spinner = document.getElementById("spinner");
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
  video.onerror = null;
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

function startRemotePolling() {
  const deviceId = getDeviceId();
  const displayEl = document.getElementById("deviceIdDisplay");
  if (displayEl) displayEl.textContent = deviceId;
  const uploadUrlEl = document.getElementById("uploadUrlDisplay");
  if (uploadUrlEl) {
    const base = (window.location.origin + window.location.pathname).replace(/[^/]*$/, "");
    uploadUrlEl.textContent = base + "upload.php";
  }

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
  const loginError = document.getElementById("loginError");
  if (loginError) loginError.textContent = "Descargando lista... Por favor espera.";
  showSpinner(true);

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

      parseM3U(m3uContent);
      if (!channelsData.length) throw new Error("La lista no contiene canales");
      finishLogin(currentUser);
      checkAccountExpiryFromChannels();
      showSpinner(false);
      return true;
    }

    if (hasXtream) {
      currentServer = serverUrl;
      const response = await fetchXtream("player_api.php", { username, password }, serverUrl);
      const rawText = await response.text();
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

      if (Number(data.user_info.auth) === 1) {
        currentUser = { username, password, server: serverUrl, info: data.user_info, isM3U: false };
        localStorage.setItem("xtream_user", JSON.stringify(currentUser));

        await loadM3UFromXtream();
        finishLogin(currentUser);
        if (currentServer.includes("acortador.vip")) checkAccountExpiryFromChannels();
        showSpinner(false);
        return true;
      }
      throw new Error("Credenciales inválidas.");
    }

    throw new Error("Rellena los datos de Xtream o usa una URL M3U.");
  } catch (error) {
    showSpinner(false);
    if (loginError) loginError.textContent = error.message || "Error al iniciar sesión.";
    startRemotePolling();
    return false;
  }
}

/********** AUTO-LOGIN **********/
window.addEventListener("DOMContentLoaded", async () => {
  detectDevice();
  const savedUser = localStorage.getItem("xtream_user");
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    performLoginAction(currentUser.server, currentUser.username, currentUser.password, currentUser.m3uUrl);
  } else {
    startRemotePolling();
  }
});

window.addEventListener("resize", detectDevice);

const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
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
  setTimeout(() => {
    loadXML_EPG();
  }, 3000);
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
async function loadXML_EPG() {
  try {
    const response = await fetch(EPG_URL);
    const text = await response.text();
    setTimeout(() => {
      try {
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, "text/xml");
        const programmes = xml.querySelectorAll("programme");
        globalEPGData = Array.from(programmes).map((prog) => ({
          channelId: prog.getAttribute("channel"),
          start: prog.getAttribute("start"),
          stop: prog.getAttribute("stop"),
          title: prog.querySelector("title") ? prog.querySelector("title").textContent : "Sin título",
        }));
      } catch (e) {}
    }, 100);
  } catch (e) {}
}

function fetchEPG(channel) {
  if (!epgNowEl) return;
  epgNowEl.textContent = "Buscando EPG...";
  if (epgNextEl) epgNextEl.textContent = "--:--";

  if (!globalEPGData.length) {
    epgNowEl.textContent = "Sin información en la guía";
    return;
  }

  let channelProgs = globalEPGData.filter((p) => p.channelId === channel.tvgId);
  if (channelProgs.length === 0) {
    const safeChannelName = (channel.name || "").toLowerCase().trim();
    channelProgs = globalEPGData.filter((p) => p.channelId && p.channelId.toLowerCase().includes(safeChannelName));
  }

  if (channelProgs.length === 0) {
    epgNowEl.textContent = "Sin información en la guía";
    return;
  }

  const now = new Date();
  let currentProg = null,
    nextProg = null;

  for (let i = 0; i < channelProgs.length; i++) {
    const p = channelProgs[i];
    const start = parseXMLDate(p.start);
    const stop = parseXMLDate(p.stop);

    if (now >= start && now <= stop) {
      currentProg = p;
      nextProg = channelProgs[i + 1] || null;
      break;
    }
  }

  if (currentProg) {
    epgNowEl.textContent = "▶ AHORA: " + currentProg.title + " (" + formatTime(parseXMLDate(currentProg.start)) + ")";
    if (epgNextEl && nextProg) {
      epgNextEl.textContent = "⏭ DESPUÉS: " + nextProg.title + " (" + formatTime(parseXMLDate(nextProg.start)) + ")";
    }
  } else {
    epgNowEl.textContent = "Sin programación en este momento";
  }
}

function parseXMLDate(str) {
  if (!str) return new Date();
  const y = str.substring(0, 4),
    m = str.substring(4, 6) - 1,
    d = str.substring(6, 8),
    h = str.substring(8, 10),
    min = str.substring(10, 12),
    s = str.substring(12, 14);
  return new Date(y, m, d, h, min, s);
}

function formatTime(date) {
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
      const safeName = nameMatch ? nameMatch[1].trim() : "Canal";
      const category = groupMatch ? groupMatch[1] : "Sin categoría";
      const tvgId = tvgIdMatch ? tvgIdMatch[1] : "";
      const idBase = (tvgId || "") + "|" + category + "|" + safeName + "|" + extinf;
      const stableId = "ch_" + idBase.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
      currentChannel = { name: safeName, category: category, tvgId: tvgId, id: stableId };
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
  renderCategories();
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
    "muestras url raras:",
    d.skippedSamples && d.skippedSamples.length ? d.skippedSamples.join("\n") : "  (ninguna)",
    "canales por categoria:",
    catLines || "  (vacio)",
  ].join("\n");
}

function setDebugOpen(open) {
  const overlay = document.getElementById("debugOverlay");
  const output = document.getElementById("debugOutput");
  if (!overlay || !output) return;
  if (open) {
    output.textContent = getDebugReport();
    overlay.hidden = false;
  } else {
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
  currentFocus.col = 0;
}

function renderChannels(channels) {
  if (channelsContainer) channelsContainer.innerHTML = "";

  channels.forEach((channel) => {
    const channelDiv = document.createElement("div");
    channelDiv.className = "channel-item";
    channelDiv.dataset.id = channel.id;

    const nameEl = document.createElement("div");
    nameEl.className = "channel-info channel-name";
    nameEl.textContent = channel.name;

    channelDiv.appendChild(nameEl);

    channelDiv.addEventListener("click", () => {
      if (currentlyPlayingId === channel.id) {
        if (video.requestFullscreen) video.requestFullscreen();
      } else {
        currentlyPlayingId = channel.id;
        document.querySelectorAll(".channel-item").forEach((i) => i.classList.remove("playing"));
        document.querySelectorAll(".channel-item").forEach((i) => {
          if (i.dataset.id === channel.id) i.classList.add("playing");
        });

        playChannel(channel);
        fetchEPG(channel);
      }
    });

    if (channelsContainer) channelsContainer.appendChild(channelDiv);
  });
}

/********** MOTOR DE REPRODUCCIÓN **********/
function playChannel(channel) {
  if (!video) return;
  showSpinner(true);
  stopPlayback();
  updateActivity(channel);

  const currentDomain = window.location.origin + window.location.pathname.replace("index.html", "");
  const originalUrl = channel.url;
  const isTs = /\.ts(\?|$)/i.test(originalUrl) || originalUrl.toLowerCase().includes(".ts");
  const isM3u8 = /\.m3u8(\?|$)/i.test(originalUrl) || originalUrl.toLowerCase().includes(".m3u8");
  const bufferSec = getBufferSeconds();

  const tryAutoPlay = () => {
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.then(() => showSpinner(false)).catch(() => showSpinner(false));
    } else {
      showSpinner(false);
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
      p.then(() => showSpinner(false)).catch(() => showSpinner(false));
    } else {
      showSpinner(false);
    }
    mpegtsPlayer.on(mpegts.Events.ERROR, () => showSpinner(false));
  } else if (isTs && !mseSupported) {
    const iosUrl = originalUrl.replace(/\.ts(\?|$)/i, ".m3u8$1");
    video.setAttribute("data-active-url", iosUrl);
    video.src = iosUrl;
    video.addEventListener("loadedmetadata", tryAutoPlay, { once: true });
    video.onerror = () => showSpinner(false);
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
      hls.on(Hls.Events.MANIFEST_PARSED, tryAutoPlay);
      hls.on(Hls.Events.ERROR, (e, data) => {
        if (data.fatal) showSpinner(false);
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

/********** SISTEMA DE BOTONES **********/
function doLogout() {
  sendActivity("stop");
  stopActivityMonitoring();
  localStorage.removeItem("xtream_user");
  stopPlayback();
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
let currentFocus = { col: 1, row: 0 };
let loginFocusIndex = -1;
const loginElements = ["serverUrl", "username", "password", "m3uUrl", "loginSubmitBtn"];

document.addEventListener("keydown", (e) => {
  if (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0") {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    noteDebugZero();
    return;
  }
  if (e.key === "Escape") {
    setDebugOpen(false);
  }

  const validKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"];
  if (!validKeys.includes(e.key)) return;

  if (document.fullscreenElement || document.webkitFullscreenElement || currentFocus.col === 2) {
    if (e.key === "Enter") {
      e.preventDefault();
      video.paused ? video.play() : video.pause();
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
      video.currentTime += 15;
      return;
    }
    if (e.key === "ArrowLeft") {
      if (currentFocus.col === 2 && !document.fullscreenElement) {
        currentFocus.col = 1;
        updateCursorVisuals();
        return;
      }
      e.preventDefault();
      video.currentTime -= 15;
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

const iosDownloadBtn = document.getElementById("iosDownloadBtn");
const iosInstallOverlay = document.getElementById("iosInstallOverlay");
const iosInstallClose = document.getElementById("iosInstallClose");
const iosIpaLink = document.getElementById("iosIpaLink");
if (iosDownloadBtn && iosInstallOverlay) {
  iosDownloadBtn.addEventListener("click", async () => {
    let hasIpa = false;
    try {
      const res = await fetch("downloads/streambox.ipa", { method: "HEAD" });
      hasIpa = res.ok;
    } catch (e) {}
    if (iosIpaLink) iosIpaLink.hidden = !hasIpa;
    iosInstallOverlay.hidden = false;
  });
}
if (iosInstallClose && iosInstallOverlay) {
  iosInstallClose.addEventListener("click", () => {
    iosInstallOverlay.hidden = true;
  });
}
