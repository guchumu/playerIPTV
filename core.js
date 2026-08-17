/*******************************************************
 * STREAMBOX IPTV - CORE.JS 5.0
 * IDs estables, EPG, mando/TV, HLS m3u8, heartbeat
 *******************************************************/

if (!window.CSS) window.CSS = {};
if (!CSS.escape) {
  CSS.escape = function (value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  };
}

const HLS_PROXY = "api/hls_proxy.php?u=";
const EPG_UPDATE_INTERVAL = 5 * 60 * 60 * 1000;
const LONG_PRESS_DURATION = 3000;
const PREBUFFER_SECONDS = 8;
const HEADER_BUTTON_IDS = ["refreshBtn", "castButton", "logoutBtn"];

const video = document.getElementById("videoPlayer");
const spinner = document.getElementById("spinner");
const channelsContainer = document.getElementById("channelsContainer");
const categoriesContainer = document.getElementById("categoriesContainer");
const channelColumnTitle = document.getElementById("channelColumnTitle");
const channelsContainerMobile = document.getElementById("channelsContainerMobile");
const categoriesContainerMobile = document.getElementById("categoriesContainerMobile");
const channelColumnTitleMobile = document.getElementById("channelColumnTitleMobile");
const mobileMenu = document.getElementById("mobileMenu");
const menuToggle = document.getElementById("menuToggle");
const videoControls = document.getElementById("videoControls");
const playBtn = document.getElementById("playBtn");
const pauseBtn = document.getElementById("pauseBtn");
const muteBtn = document.getElementById("muteBtn");
const volumeSlider = document.getElementById("volumeSlider");
const currentTimeDisplay = document.getElementById("currentTime");
const pipBtn = document.getElementById("pipBtn");
const airplayBtn = document.getElementById("airplayBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const currentChannelNameEl = document.getElementById("currentChannelName");

let hls = null;
let currentUser = null;
let currentChannelIndex = 0;
let currentCategoryIndex = 0;
let channelsData = [];
let categoriesData = {};
let currentCategory = null;
let currentPlayingChannel = null;
let cursorInCategories = true;
let epgData = {};
let activeConnection = null;
let favorites = JSON.parse(localStorage.getItem("favorites") || "[]");
let history = JSON.parse(localStorage.getItem("history") || "[]");
let castSession = null;
let longPressTimer = null;
let skipChannelClick = false;
let controlsTimeout = null;
let dataConsumed = 0;
let lastDataCheck = 0;
let dataInterval = null;
let currentHeaderButtonIndex = 0;
let inHeaderNavigation = false;
let sessionToken = null;
let activityInterval = null;
let heartbeatInterval = null;
let bufferCheckTimer = null;
let epgReloadTimer = null;
let controlsInitialized = false;
let searchInitialized = false;
let mobileInitialized = false;
let keyboardInitialized = false;
let castInitialized = false;
let appReady = false;

/********** DISPOSITIVO **********/
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
  return { isTV, isMobile, isIOS };
}

/********** UI HELPERS **********/
function showScreen(name) {
  const login = document.getElementById("loginScreen");
  const main = document.getElementById("mainScreen");
  if (!login || !main) return;
  login.classList.toggle("active", name === "login");
  main.classList.toggle("active", name === "main");
  login.style.display = "";
  main.style.display = "";
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

function showSpinner(show) {
  if (!spinner) return;
  spinner.style.display = show ? "flex" : "none";
}

function clearBufferCheck() {
  if (bufferCheckTimer) {
    clearInterval(bufferCheckTimer);
    bufferCheckTimer = null;
  }
}

function hideBufferIcon() {
  const bufferIcon = document.getElementById("bufferIcon");
  if (bufferIcon) bufferIcon.style.display = "none";
}

function stableChannelId(ch) {
  if (ch.tvgId) return "tvg:" + ch.tvgId;
  return "name:" + (ch.category || "") + ":" + (ch.name || "");
}

function toPlayableUrl(url) {
  if (!url) return url;
  let u = url;
  if (/\.ts(\?|$)/i.test(u)) u = u.replace(/\.ts(\?|$)/i, ".m3u8$1");
  if (u.indexOf("http://") === 0) {
    return HLS_PROXY + encodeURIComponent(u);
  }
  return u;
}

function isLiveDuration(d) {
  return !d || !isFinite(d);
}

function formatTime(seconds) {
  if (isLiveDuration(seconds)) return "LIVE";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m + ":" + s.toString().padStart(2, "0");
}

function formatExpiry(info) {
  if (!info) return "";
  let ts = info.exp_date;
  if (!ts) return "";
  if (typeof ts === "string" && ts.length > 10 && ts.indexOf("-") >= 0) {
    return ts.slice(0, 10);
  }
  const n = parseInt(ts, 10);
  if (!n) return "";
  const d = new Date(n * 1000);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-ES");
}

/********** PROXY XTREAM **********/
async function fetchXtream(endpoint, params) {
  const queryString = new URLSearchParams(params || {}).toString();
  const url = "xtream_proxy.php?endpoint=" + encodeURIComponent(endpoint) + "&" + queryString;
  return fetch(url, { credentials: "same-origin" });
}

function isXtreamAuthorized(data) {
  if (!data || !data.user_info) return false;
  return Number(data.user_info.auth) === 1;
}

function isXtreamProxyFailure(response, data, rawText) {
  const status = response ? response.status : 0;
  const err = data && (data.error || data.message);
  const errStr = err ? String(err) : "";
  if (status >= 500 || status === 400) return true;
  if (data && data.error === "proxy_error") return true;
  if (/proxy_error|Error de conexión|no se pudo conectar|Endpoint no permitido/i.test(errStr)) {
    return true;
  }
  if (rawText && /<!DOCTYPE|<html/i.test(rawText)) return true;
  return false;
}

async function readXtreamJson(response) {
  const text = await response.text();
  if (!text) return { data: null, text: "" };
  try {
    return { data: JSON.parse(text), text };
  } catch (e) {
    return { data: null, text };
  }
}

function xtreamLoginFailureMessage(response, data, rawText) {
  if (isXtreamProxyFailure(response, data, rawText) || (!data && !response.ok && response.status !== 401 && response.status !== 403)) {
    const detail = data && (data.message || data.error);
    return detail && String(detail) !== "proxy_error"
      ? String(detail)
      : "No se pudo conectar con el servidor (error de red o proxy)";
  }
  return "Usuario o contraseña incorrectos";
}

/********** MONITOR DATOS **********/
function startDataMonitoring() {
  if (dataInterval) clearInterval(dataInterval);
  dataConsumed = 0;
  lastDataCheck = 0;
  dataInterval = setInterval(() => {
    if (!video || !video.src) return;
    const buffered = video.buffered;
    let bufferSeconds = 0;
    if (buffered.length > 0) {
      bufferSeconds = buffered.end(buffered.length - 1) - video.currentTime;
    }
    let resolution = "N/A";
    if (video.videoWidth && video.videoHeight) {
      resolution = video.videoWidth + "x" + video.videoHeight;
    }
    if (hls && hls.levels && hls.currentLevel >= 0) {
      const level = hls.levels[hls.currentLevel];
      if (level && level.bitrate) {
        const now = Date.now();
        if (lastDataCheck > 0) {
          const timeDiff = (now - lastDataCheck) / 1000;
          dataConsumed += (level.bitrate / 8) * timeDiff;
        }
        lastDataCheck = now;
      }
    }
    console.log("Buffer " + bufferSeconds.toFixed(1) + "s | " + resolution);
  }, 5000);
}

function stopDataMonitoring() {
  if (dataInterval) {
    clearInterval(dataInterval);
    dataInterval = null;
  }
  dataConsumed = 0;
  lastDataCheck = 0;
}

/********** ACTIVIDAD / HEARTBEAT **********/
function generateSessionToken() {
  const user = currentUser && currentUser.username ? currentUser.username : "user";
  sessionToken = user + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 11);
}

function startActivityMonitoring() {
  if (activityInterval) clearInterval(activityInterval);
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (!currentUser) return;
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
  if (!currentUser) return;
  try {
    const body = { username: currentUser.username, action: action || "update" };
    if (action !== "stop" && activeConnection) {
      body.channel = activeConnection.channel;
      body.url = video ? video.src : "";
    }
    await fetch("activity_api.php", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn("Actividad no enviada");
  }
}

async function sendHeartbeat() {
  if (!currentUser || !sessionToken) return;
  try {
    const res = await fetch("heartbeat.php", {
      method: "POST",
      credentials: "same-origin",
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
      logoutUser();
      return;
    }
    if (data.stop_playback) {
      stopPlayback();
      showToast("Reproducción detenida por el administrador");
    }
  } catch (e) {
    console.warn("Heartbeat error");
  }
}

function updateActivity(channel) {
  if (!currentUser) return;
  activeConnection = {
    user: currentUser.username,
    channel: channel.name,
    startTime: new Date(),
  };
  sendActivity();
}

/********** LOGIN / LOGOUT **********/
function updateHeaderInfo() {
  if (!currentUser) return;
  const headerUser = document.getElementById("headerUser");
  const headerExpire = document.getElementById("headerExpire");
  const headerConnections = document.getElementById("headerConnections");
  if (headerUser) headerUser.textContent = currentUser.username;
  const info = currentUser.info || {};
  if (headerExpire) {
    const exp = formatExpiry(info);
    headerExpire.textContent = exp ? "Caduca: " + exp : "";
  }
  if (headerConnections) {
    const maxc = info.max_connections != null ? info.max_connections : "";
    const active = info.active_cons != null ? info.active_cons : "";
    headerConnections.textContent =
      maxc !== "" ? "Conexiones: " + active + "/" + maxc : "";
  }
}

function stopPlayback() {
  clearBufferCheck();
  hideBufferIcon();
  showSpinner(false);
  stopDataMonitoring();
  try {
    if (hls) {
      hls.destroy();
      hls = null;
    }
  } catch (e) {}
  if (video) {
    try {
      video.pause();
    } catch (e) {}
    video.removeAttribute("src");
    video.load();
  }
  activeConnection = null;
}

function logoutUser() {
  sendActivity("stop");
  localStorage.removeItem("xtream_user");
  stopActivityMonitoring();
  stopPlayback();
  if (epgReloadTimer) {
    clearInterval(epgReloadTimer);
    epgReloadTimer = null;
  }
  currentUser = null;
  sessionToken = null;
  appReady = false;
  showScreen("login");
}

async function enterApp() {
  updateHeaderInfo();
  showScreen("main");
  await loadM3UFromXtream();
  generateSessionToken();
  startActivityMonitoring();
  initializeVideoControls();
  initializeMobileMenu();
  initializeSearch();
  initializeKeyboard();
  initializeCast();
  appReady = true;
  setTimeout(() => {
    cursorInCategories = true;
    currentCategoryIndex = 0;
    updateCursor();
  }, 100);
  setTimeout(() => {
    loadEPG();
    if (epgReloadTimer) clearInterval(epgReloadTimer);
    epgReloadTimer = setInterval(loadEPG, EPG_UPDATE_INTERVAL);
  }, 2500);
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();
  const loginError = document.getElementById("loginError");

  if (!username || !password) {
    loginError.textContent = "Por favor completa todos los campos";
    return;
  }

  loginError.textContent = "Conectando...";
  try {
    const response = await fetchXtream("player_api.php", { username, password });
    const parsed = await readXtreamJson(response);
    const data = parsed.data;
    if (isXtreamAuthorized(data)) {
      currentUser = {
        username,
        password,
        info: data.user_info,
        server_info: data.server_info,
      };
      localStorage.setItem("xtream_user", JSON.stringify(currentUser));
      loginError.textContent = "";
      await enterApp();
    } else {
      throw new Error(xtreamLoginFailureMessage(response, data, parsed.text));
    }
  } catch (error) {
    loginError.textContent = error.message || "Error al iniciar sesión";
  }
});

async function refreshPlaylist() {
  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "⏳";
  }
  try {
    await loadM3UFromXtream();
    showToast("Lista actualizada");
  } catch (error) {
    showToast("Error al actualizar la lista");
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = "🔄";
    }
  }
}

document.getElementById("refreshBtn").addEventListener("click", refreshPlaylist);
document.getElementById("logoutBtn").addEventListener("click", logoutUser);

/********** M3U **********/
async function loadM3UFromXtream() {
  const response = await fetchXtream("get.php", {
    username: currentUser.username,
    password: currentUser.password,
    type: "m3u_plus",
    output: "m3u8",
  });
  const m3uContent = await response.text();
  parseM3U(m3uContent);
}

function parseM3U(content) {
  const lines = content.split(/\r?\n/);
  const channels = [];
  const categories = {};
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.indexOf("#EXTINF:") === 0) {
      const logoMatch = line.match(/tvg-logo="([^"]*)"/);
      const idMatch = line.match(/tvg-id="([^"]*)"/);
      const groupMatch = line.match(/group-title="([^"]*)"/);
      const nameMatch = line.match(/,(.+)$/);
      current = {
        name: nameMatch ? nameMatch[1].trim() : "Canal sin nombre",
        logo: logoMatch ? logoMatch[1] : "",
        tvgId: idMatch ? idMatch[1] : "",
        category: groupMatch ? groupMatch[1] : "Sin categoría",
        url: "",
        id: "",
      };
    } else if (current && (line.indexOf("http") === 0 || line.indexOf("rtmp") === 0)) {
      current.url = line;
      current.id = stableChannelId(current);
      channels.push(current);
      if (!categories[current.category]) categories[current.category] = [];
      categories[current.category].push(current);
      current = null;
    }
  }

  channelsData = channels;
  categoriesData = categories;
  renderCategories();
}

function getCurrentChannelList() {
  if (currentCategory === "⭐ Favoritos") {
    return channelsData.filter((ch) => favorites.indexOf(ch.id) >= 0);
  }
  if (currentCategory === "🕒 Historial") {
    return history
      .map((id) => channelsData.find((ch) => ch.id === id))
      .filter(Boolean);
  }
  return categoriesData[currentCategory] || [];
}

function renderCategories() {
  categoriesContainer.innerHTML = "";
  if (categoriesContainerMobile) categoriesContainerMobile.innerHTML = "";

  const categoryNames = Object.keys(categoriesData).sort(function (a, b) {
    return a.localeCompare(b, "es");
  });
  const special = [];
  if (history.length > 0) special.push("🕒 Historial");
  if (favorites.length > 0) special.push("⭐ Favoritos");
  const all = special.concat(categoryNames);

  all.forEach((catName, index) => {
    categoriesContainer.appendChild(createCategoryButton(catName, index));
    if (categoriesContainerMobile) {
      categoriesContainerMobile.appendChild(createAccordionCategory(catName, index));
    }
  });

  if (all.length > 0) {
    const keep = all.indexOf(currentCategory);
    const idx = keep >= 0 ? keep : 0;
    selectCategory(all[idx], idx);
  }
}

function createCategoryButton(catName, index) {
  const btn = document.createElement("button");
  btn.className = "category-btn";
  btn.type = "button";
  let displayText = catName;
  if (catName === "⭐ Favoritos") {
    displayText = catName + " (" + favorites.length + ")";
  } else if (catName !== "🕒 Historial") {
    displayText = catName + " (" + ((categoriesData[catName] || []).length) + ")";
  }
  btn.textContent = displayText;
  btn.dataset.category = catName;
  btn.dataset.index = String(index);
  btn.addEventListener("click", () => selectCategory(catName, index));
  return btn;
}

function createAccordionCategory(catName, index) {
  const accordionItem = document.createElement("div");
  accordionItem.className = "accordion-item";
  const header = document.createElement("div");
  header.className = "accordion-header";
  header.textContent = catName;
  header.dataset.category = catName;
  header.addEventListener("click", () => {
    const open = header.classList.contains("active");
    document.querySelectorAll(".accordion-header").forEach((h) => h.classList.remove("active"));
    if (!open) {
      header.classList.add("active");
      selectCategory(catName, index);
      loadChannelsInAccordion(catName, channelsContainerMobile);
    } else if (channelsContainerMobile) {
      channelsContainerMobile.innerHTML = "";
    }
  });
  accordionItem.appendChild(header);
  return accordionItem;
}

function loadChannelsInAccordion(categoryName, container) {
  if (!container) return;
  currentCategory = categoryName;
  const channelsToShow = getCurrentChannelList();
  container.innerHTML = "";
  channelsToShow.forEach((channel, index) => {
    container.appendChild(createChannelItem(channel, index));
  });
}

function selectCategory(categoryName, index) {
  currentCategory = categoryName;
  currentCategoryIndex = index;
  cursorInCategories = false;
  currentChannelIndex = 0;

  document.querySelectorAll(".category-btn").forEach((btn) => {
    btn.classList.remove("active", "cursor");
  });
  document.querySelectorAll('[data-category="' + CSS.escape(categoryName) + '"]').forEach((btn) => {
    if (btn.classList.contains("category-btn") || btn.classList.contains("accordion-header")) {
      btn.classList.add("active");
    }
  });

  const channelsToShow = getCurrentChannelList();
  renderChannels(channelsToShow);
  if (channelColumnTitle) channelColumnTitle.textContent = categoryName;
  if (channelColumnTitleMobile) channelColumnTitleMobile.textContent = categoryName;
}

function bindLongPress(el, channel) {
  const start = (ev) => {
    if (ev.type === "mousedown" && ev.button !== 0) return;
    skipChannelClick = false;
    longPressTimer = setTimeout(() => {
      skipChannelClick = true;
      toggleFavorite(channel.id);
      showToast(
        favorites.indexOf(channel.id) >= 0 ? "Añadido a favoritos" : "Quitado de favoritos"
      );
    }, LONG_PRESS_DURATION);
  };
  const cancel = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };
  el.addEventListener("mousedown", start);
  el.addEventListener("touchstart", start, { passive: true });
  el.addEventListener("mouseup", cancel);
  el.addEventListener("mouseleave", cancel);
  el.addEventListener("touchend", cancel);
  el.addEventListener("touchcancel", cancel);
}

function createChannelItem(channel, index) {
  const channelDiv = document.createElement("div");
  channelDiv.className = "channel-item";
  channelDiv.dataset.index = String(index);
  channelDiv.dataset.channelId = channel.id;
  if (currentPlayingChannel && currentPlayingChannel.id === channel.id) {
    channelDiv.classList.add("playing");
  }

  const isFavorite = favorites.indexOf(channel.id) >= 0;
  const info = document.createElement("div");
  info.className = "channel-info";
  const name = document.createElement("div");
  name.className = "channel-name";
  name.textContent = channel.name;
  const epg = document.createElement("div");
  epg.className = "channel-epg";
  epg.id = "epg-" + channel.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const cur = getCurrentEPG(channel);
  if (cur.now) epg.textContent = cur.now.start + " " + cur.now.title;
  info.appendChild(name);
  info.appendChild(epg);
  channelDiv.appendChild(info);

  const favBtn = document.createElement("button");
  favBtn.type = "button";
  favBtn.className = "fav-btn" + (isFavorite ? " active" : "");
  favBtn.textContent = isFavorite ? "⭐" : "☆";
  favBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(channel.id);
  });
  channelDiv.appendChild(favBtn);

  channelDiv.addEventListener("click", () => {
    if (skipChannelClick) {
      skipChannelClick = false;
      return;
    }
    playChannel(channel, index);
    if (mobileMenu) mobileMenu.classList.remove("show");
  });
  bindLongPress(channelDiv, channel);
  return channelDiv;
}

function renderChannels(channels) {
  const containers = [channelsContainer];
  if (channelsContainerMobile) containers.push(channelsContainerMobile);
  containers.forEach((container) => {
    if (!container) return;
    container.innerHTML = "";
    channels.forEach((channel, index) => {
      container.appendChild(createChannelItem(channel, index));
    });
  });
  if (channels.length > 0) updateCursor();
}

function toggleFavorite(channelId) {
  const idx = favorites.indexOf(channelId);
  if (idx >= 0) favorites.splice(idx, 1);
  else favorites.push(channelId);
  localStorage.setItem("favorites", JSON.stringify(favorites));
  renderCategories();
}

function addToHistory(channelId) {
  const idx = history.indexOf(channelId);
  if (idx >= 0) history.splice(idx, 1);
  history.unshift(channelId);
  if (history.length > 50) history = history.slice(0, 50);
  localStorage.setItem("history", JSON.stringify(history));
}

/********** REPRODUCCIÓN **********/
function onPlaybackStarted(channel) {
  hideBufferIcon();
  showSpinner(false);
  showControlsGlobal();
  startDataMonitoring();
  addToHistory(channel.id);
  updateActivity(channel);
}

function playChannel(channel, index) {
  currentPlayingChannel = channel;
  currentChannelIndex = index;
  stopDataMonitoring();
  clearBufferCheck();

  const finalUrl = toPlayableUrl(channel.url);
  if (currentChannelNameEl) currentChannelNameEl.textContent = channel.name;
  showSpinner(true);
  updatePlayerEPG(channel);

  const bufferIcon = document.getElementById("bufferIcon");
  if (bufferIcon) {
    bufferIcon.innerHTML =
      '<div class="buffer-title">BUFFERIZANDO</div>' +
      '<div class="buffer-bar"><div id="bufferFill" class="buffer-fill"></div></div>' +
      '<div class="buffer-percent">0%</div>';
    bufferIcon.style.display = "block";
  }

  document.querySelectorAll(".channel-item").forEach((item) => item.classList.remove("playing"));
  document.querySelectorAll('[data-channel-id="' + CSS.escape(channel.id) + '"]').forEach((item) => {
    if (item.classList.contains("channel-item")) item.classList.add("playing");
  });

  if (hls) {
    try {
      hls.destroy();
    } catch (e) {}
    hls = null;
  }

  const isHls = /\.m3u8(\?|$)/i.test(finalUrl) || finalUrl.indexOf("hls_proxy.php") >= 0;

  if (isHls && window.Hls && Hls.isSupported()) {
    hls = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: 90,
      maxMaxBufferLength: 180,
      maxBufferSize: 180 * 1000 * 1000,
      backBufferLength: 90,
      maxBufferHole: 0.5,
      highBufferWatchdogPeriod: 3,
      nudgeMaxRetry: 15,
      nudgeOffset: 0.1,
      fragLoadingMaxRetry: 10,
      fragLoadingTimeOut: 30000,
      fragLoadingMaxRetryTimeout: 64000,
      manifestLoadingMaxRetry: 10,
      manifestLoadingTimeOut: 15000,
      manifestLoadingMaxRetryTimeout: 64000,
      startLevel: -1,
      autoStartLoad: true,
      liveSyncDurationCount: 5,
      liveMaxLatencyDurationCount: 15,
      maxLiveSyncPlaybackRate: 1,
    });
    hls.loadSource(finalUrl);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      const playPromise = video.play();
      if (!playPromise) return;
      playPromise
        .then(() => {
          video.pause();
          let checkCount = 0;
          const maxChecks = 20;
          clearBufferCheck();
          bufferCheckTimer = setInterval(() => {
            checkCount++;
            const buffered = video.buffered;
            if (buffered.length > 0) {
              const bufferAmount = buffered.end(buffered.length - 1) - video.currentTime;
              const progressPercent = Math.min((bufferAmount / PREBUFFER_SECONDS) * 100, 100);
              const fill = document.getElementById("bufferFill");
              if (fill) fill.style.width = progressPercent + "%";
              const pct = document.querySelector(".buffer-percent");
              if (pct) pct.textContent = Math.floor(progressPercent) + "%";
              if (bufferAmount >= PREBUFFER_SECONDS || checkCount >= maxChecks) {
                clearBufferCheck();
                video.play().then(() => onPlaybackStarted(channel)).catch(() => {
                  hideBufferIcon();
                  showSpinner(false);
                  showToast("Pulsa play para reproducir");
                });
              }
            } else if (checkCount >= maxChecks) {
              clearBufferCheck();
              video.play().then(() => onPlaybackStarted(channel)).catch(() => {
                hideBufferIcon();
                showSpinner(false);
              });
            }
          }, 500);
        })
        .catch(() => {
          hideBufferIcon();
          showSpinner(false);
          showToast("Pulsa play para reproducir");
        });
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (!data.fatal) return;
      hideBufferIcon();
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
      } else {
        showSpinner(false);
        showToast("Error de reproducción");
      }
    });
  } else if (video.canPlayType("application/vnd.apple.mpegurl") || isHls) {
    video.src = finalUrl;
    const playNative = () => {
      video.play().then(() => onPlaybackStarted(channel)).catch(() => {
        hideBufferIcon();
        showSpinner(false);
        showToast("Pulsa play para reproducir");
      });
    };
    video.addEventListener("canplay", playNative, { once: true });
    video.load();
  } else {
    video.src = finalUrl;
    video.play().then(() => onPlaybackStarted(channel)).catch(() => {
      hideBufferIcon();
      showSpinner(false);
    });
  }

  if (castSession) {
    try {
      castToDevice(channel);
    } catch (e) {}
  }
}

/********** CONTROLES **********/
function showControlsGlobal() {
  if (!videoControls) return;
  videoControls.classList.add("visible");
  if (controlsTimeout) clearTimeout(controlsTimeout);
  controlsTimeout = setTimeout(() => {
    if (video && !video.paused && !document.body.classList.contains("is-tv")) {
      videoControls.classList.remove("visible");
    }
  }, 5000);
}

function updateMuteIcon() {
  if (!muteBtn || !video) return;
  muteBtn.textContent = video.muted || video.volume === 0 ? "🔇" : "🔊";
}

function initializeVideoControls() {
  if (controlsInitialized || !video || !videoControls) return;
  controlsInitialized = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");

  const parent = video.parentElement;
  ["mousemove", "click", "touchstart"].forEach((evt) => {
    parent.addEventListener(evt, showControlsGlobal, { passive: true });
  });

  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    video.play();
  });
  pauseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    video.pause();
  });
  muteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    video.muted = !video.muted;
    updateMuteIcon();
  });
  if (volumeSlider) {
    volumeSlider.value = String(video.volume);
    volumeSlider.addEventListener("input", () => {
      video.volume = parseFloat(volumeSlider.value);
      video.muted = video.volume === 0;
      updateMuteIcon();
    });
  }
  fullscreenBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFullscreen();
  });

  if (pipBtn) {
    if (!document.pictureInPictureEnabled) pipBtn.style.display = "none";
    pipBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await video.requestPictureInPicture();
      } catch (err) {
        showToast("PiP no disponible");
      }
    });
  }

  if (airplayBtn) {
    if (!(window.WebKitPlaybackTargetAvailabilityEvent || video.webkitShowPlaybackTargetPicker)) {
      airplayBtn.style.display = "none";
    }
    airplayBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (video.webkitShowPlaybackTargetPicker) video.webkitShowPlaybackTargetPicker();
    });
  }

  video.addEventListener("volumechange", updateMuteIcon);
  video.addEventListener("timeupdate", () => {
    if (!currentTimeDisplay) return;
    if (isLiveDuration(video.duration)) {
      currentTimeDisplay.textContent = "EN DIRECTO";
      return;
    }
    currentTimeDisplay.textContent = formatTime(video.currentTime) + " / " + formatTime(video.duration);
  });
  updateMuteIcon();
}

function toggleFullscreen() {
  const wrap = video.parentElement;
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    if (wrap.requestFullscreen) wrap.requestFullscreen();
    else if (wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen();
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  } else if (document.exitFullscreen) {
    document.exitFullscreen();
  } else if (document.webkitExitFullscreen) {
    document.webkitExitFullscreen();
  }
}

function initializeSearch() {
  const searchInput = document.getElementById("searchInput");
  if (!searchInput || searchInitialized) return;
  searchInitialized = true;
  searchInput.addEventListener("input", () => {
    const term = searchInput.value.toLowerCase().trim();
    const baseList = getCurrentChannelList();
    const filtered = term
      ? baseList.filter((ch) => ch.name.toLowerCase().indexOf(term) >= 0)
      : baseList;
    renderChannels(filtered);
  });
}

function initializeMobileMenu() {
  if (!menuToggle || !mobileMenu || mobileInitialized) return;
  mobileInitialized = true;
  menuToggle.addEventListener("click", () => {
    mobileMenu.classList.toggle("show");
  });
}

/********** EPG **********/
function getCurrentEPG(channel) {
  const empty = { now: null, next: null };
  if (!channel || !epgData) return empty;
  const id = channel.tvgId || "";
  if (id && epgData[id]) return epgData[id];
  const lower = id.toLowerCase();
  const keys = Object.keys(epgData);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === lower) return epgData[keys[i]];
  }
  const name = (channel.name || "").toLowerCase();
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === name) return epgData[keys[i]];
  }
  return empty;
}

function formatEpgBlock(prog) {
  if (!prog) return "--:--";
  return (prog.start || "") + "–" + (prog.stop || "") + " " + (prog.title || "");
}

function updatePlayerEPG(channel) {
  const info = getCurrentEPG(channel);
  const nowEl = document.getElementById("epgNow");
  const nextEl = document.getElementById("epgNext");
  if (nowEl) nowEl.textContent = formatEpgBlock(info.now);
  if (nextEl) nextEl.textContent = formatEpgBlock(info.next);
}

async function loadEPG() {
  try {
    const res = await fetch("api/get_epg.php", { credentials: "same-origin" });
    const data = await res.json();
    epgData = data.channels || {};
    if (currentPlayingChannel) updatePlayerEPG(currentPlayingChannel);
  } catch (e) {
    console.warn("EPG no disponible");
  }
}

/********** TECLADO / MANDO **********/
function getVisibleCategoryButtons() {
  return Array.from(categoriesContainer.querySelectorAll(".category-btn"));
}

function getVisibleChannelItems() {
  return Array.from(channelsContainer.querySelectorAll(".channel-item"));
}

function updateCursor() {
  document.querySelectorAll(".cursor").forEach((el) => el.classList.remove("cursor"));
  if (inHeaderNavigation) {
    const id = HEADER_BUTTON_IDS[currentHeaderButtonIndex];
    const btn = document.getElementById(id);
    if (btn && btn.style.display !== "none") btn.classList.add("cursor");
    return;
  }
  if (cursorInCategories) {
    const btns = getVisibleCategoryButtons();
    const btn = btns[currentCategoryIndex];
    if (btn) {
      btn.classList.add("cursor");
      btn.scrollIntoView({ block: "nearest" });
    }
  } else {
    const items = getVisibleChannelItems();
    if (currentChannelIndex < 0) currentChannelIndex = 0;
    if (currentChannelIndex >= items.length) currentChannelIndex = Math.max(0, items.length - 1);
    const item = items[currentChannelIndex];
    if (item) {
      item.classList.add("cursor");
      item.scrollIntoView({ block: "nearest" });
    }
  }
}

function changeChannel(delta) {
  const list = getCurrentChannelList();
  if (!list.length) return;
  let idx = currentChannelIndex + delta;
  if (idx < 0) idx = list.length - 1;
  if (idx >= list.length) idx = 0;
  playChannel(list[idx], idx);
  updateCursor();
}

function activateCursor() {
  if (inHeaderNavigation) {
    const id = HEADER_BUTTON_IDS[currentHeaderButtonIndex];
    const btn = document.getElementById(id);
    if (btn) btn.click();
    return;
  }
  if (cursorInCategories) {
    const btns = getVisibleCategoryButtons();
    const btn = btns[currentCategoryIndex];
    if (btn) btn.click();
    cursorInCategories = false;
    currentChannelIndex = 0;
    updateCursor();
  } else {
    const list = getCurrentChannelList();
    if (list[currentChannelIndex]) playChannel(list[currentChannelIndex], currentChannelIndex);
  }
}

function initializeKeyboard() {
  if (keyboardInitialized) return;
  keyboardInitialized = true;
  document.addEventListener("keydown", (e) => {
    if (!appReady) return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") {
      if (e.key === "Escape") e.target.blur();
      return;
    }

    const key = e.key;
    const code = e.code;
    const isBack = key === "Escape" || key === "Backspace" || key === "BrowserBack";
    const isPlayPause = key === " " || key === "MediaPlayPause" || code === "MediaPlayPause" || key === "Pause";

    if (
      key === "ArrowUp" ||
      key === "ArrowDown" ||
      key === "ArrowLeft" ||
      key === "ArrowRight" ||
      key === "Enter" ||
      key === " " ||
      isBack
    ) {
      e.preventDefault();
    }

    if (isPlayPause) {
      if (video.paused) video.play();
      else video.pause();
      showControlsGlobal();
      return;
    }

    if (key === "MediaTrackNext" || key === "PageDown") {
      changeChannel(1);
      return;
    }
    if (key === "MediaTrackPrevious" || key === "PageUp") {
      changeChannel(-1);
      return;
    }
    if (key === "f" || key === "F") {
      toggleFullscreen();
      return;
    }

    if (isBack) {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        toggleFullscreen();
        return;
      }
      if (mobileMenu && mobileMenu.classList.contains("show")) {
        mobileMenu.classList.remove("show");
        return;
      }
      if (!cursorInCategories && !inHeaderNavigation) {
        cursorInCategories = true;
        updateCursor();
      }
      return;
    }

    if (key === "Enter") {
      activateCursor();
      return;
    }

    if (inHeaderNavigation) {
      if (key === "ArrowLeft") {
        currentHeaderButtonIndex = Math.max(0, currentHeaderButtonIndex - 1);
        updateCursor();
      } else if (key === "ArrowRight") {
        currentHeaderButtonIndex = Math.min(HEADER_BUTTON_IDS.length - 1, currentHeaderButtonIndex + 1);
        updateCursor();
      } else if (key === "ArrowDown") {
        inHeaderNavigation = false;
        cursorInCategories = true;
        updateCursor();
      }
      return;
    }

    if (key === "ArrowLeft") {
      if (!cursorInCategories) {
        cursorInCategories = true;
        updateCursor();
      }
      return;
    }
    if (key === "ArrowRight") {
      if (cursorInCategories) {
        cursorInCategories = false;
        currentChannelIndex = 0;
        updateCursor();
      }
      return;
    }
    if (key === "ArrowUp") {
      if (cursorInCategories) {
        if (currentCategoryIndex <= 0) {
          inHeaderNavigation = true;
          currentHeaderButtonIndex = 0;
        } else {
          currentCategoryIndex -= 1;
        }
      } else if (currentChannelIndex <= 0) {
        inHeaderNavigation = true;
        currentHeaderButtonIndex = 0;
      } else {
        currentChannelIndex -= 1;
      }
      updateCursor();
      return;
    }
    if (key === "ArrowDown") {
      if (cursorInCategories) {
        const max = getVisibleCategoryButtons().length - 1;
        currentCategoryIndex = Math.min(max, currentCategoryIndex + 1);
      } else {
        const max = getVisibleChannelItems().length - 1;
        currentChannelIndex = Math.min(max, currentChannelIndex + 1);
      }
      updateCursor();
    }
  });
}

/********** CHROMECAST **********/
function initializeCast() {
  if (castInitialized) return;
  castInitialized = true;
  const btn = document.getElementById("castButton");
  if (!btn) return;
  btn.style.display = "none";

  document.addEventListener("cast-ready", (e) => {
    if (!e.detail) return;
    btn.style.display = "";
    try {
      window.cast.framework.CastContext.getInstance().setOptions({
        receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });
    } catch (err) {}
  });

  btn.addEventListener("click", async () => {
    try {
      const ctx = window.cast.framework.CastContext.getInstance();
      await ctx.requestSession();
      castSession = ctx.getCurrentSession();
      if (currentPlayingChannel) castToDevice(currentPlayingChannel);
    } catch (err) {
      showToast("Chromecast no disponible");
    }
  });
}

function castToDevice(channel) {
  if (!channel) return;
  const session =
    castSession ||
    (window.cast &&
      window.cast.framework &&
      window.cast.framework.CastContext.getInstance().getCurrentSession());
  if (!session) return;
  castSession = session;
  const url = channel.url;
  const mediaInfo = new window.chrome.cast.media.MediaInfo(url, "application/x-mpegURL");
  mediaInfo.streamType = window.chrome.cast.media.StreamType.LIVE;
  mediaInfo.metadata = new window.chrome.cast.media.GenericMediaMetadata();
  mediaInfo.metadata.title = channel.name;
  const request = new window.chrome.cast.media.LoadRequest(mediaInfo);
  session.loadMedia(request);
}

/********** ARRANQUE **********/
detectDevice();
window.addEventListener("resize", detectDevice);

window.addEventListener("beforeunload", () => {
  if (currentUser) {
    navigator.sendBeacon(
      "activity_api.php",
      new Blob([JSON.stringify({ username: currentUser.username, action: "stop" })], {
        type: "application/json",
      })
    );
  }
});

window.addEventListener("load", async () => {
  detectDevice();
  const savedUser = localStorage.getItem("xtream_user");
  if (!savedUser) return;
  try {
    currentUser = JSON.parse(savedUser);
    const response = await fetchXtream("player_api.php", {
      username: currentUser.username,
      password: currentUser.password,
    });
    const parsed = await readXtreamJson(response);
    const data = parsed.data;
    if (isXtreamAuthorized(data)) {
      currentUser.info = data.user_info;
      await enterApp();
    } else if (isXtreamProxyFailure(response, data, parsed.text)) {
      console.error("Error auto-login (proxy/red):", data && (data.message || data.error));
    } else {
      localStorage.removeItem("xtream_user");
    }
  } catch (e) {
    console.error("Error auto-login:", e);
  }
});
