/*******************************************************
 * STREAMBOX IPTV - CORE.JS (backup que funcionaba + mejoras)
 * Login por QR (carga remota), get.php output=ts, parseM3U, mpegts/HLS / ExoPlayer|LibVLC
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
let nativePlaybackActive = false;
let nativeFullscreen = false;
const BUFFER_KEY = "streambox_buffer";
const LAST_LIST_KEY = "streambox_last_list";
const SAVED_LISTS_KEY = "streambox_saved_lists";
const ACTIVE_LIST_KEY = "streambox_active_list";
const ALL_LISTS_ID = "__all__";
const LOGOUT_AT_KEY = "streambox_logout_at";
const TV_HEADER_COL = -1;
const DEFAULT_BUFFER_SECONDS = 10;
// Esperar más de esto antes de ver imagen se hace insoportable al zapear, así
// que un ajuste alto sigue valiendo como techo pero no como espera.
const PREBUFFER_MAX_SECONDS = 20;
/**
 * Tope real de espera al cambiar de canal.
 *
 * Un colchón de N segundos solo se construye dejando que pasen N segundos: si
 * el origen emite a tiempo real, lo acumulado crece a la misma velocidad que
 * el reloj. Por eso pedir 10s de colchón costaba 10s de pantalla en negro.
 *
 * Ya no hace falta pagarlo: la reproducción arranca en el punto más antiguo de
 * lo descargado, así que la ráfaga inicial que manda el proveedor ya se hereda
 * como colchón sin esperar nada. Esta espera solo remata lo que falte, y con
 * un tope corto para que zapear sea llevadero.
 */
const PREBUFFER_MAX_WAIT_MS = 4000;
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
let liveSession = false;
let logoutRequested = false;
let remoteLoginBusy = false;
let remotePollGen = 0;
const EPG_RETRY_DELAYS = [8000, 20000, 45000, 90000, 180000, 300000];
let channelById = new Map();
let pollingInterval = null;
let sessionToken = null;
let activityInterval = null;
let heartbeatInterval = null;
let activeConnection = null;
let savedLists = [];
let activeListId = null;
let listAddPollGen = 0;
let listAddPollTimer = null;
let pendingListName = null;

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

function showVideoSpinner(show, message, skippable) {
  clearTimeout(bufferingSpinnerTimer);
  bufferingSpinnerTimer = null;
  if (spinner) spinner.style.display = show ? "flex" : "none";
  const text = document.getElementById("spinnerText");
  if (text) text.textContent = show ? message || "" : "";
  // El botón de saltar solo tiene sentido mientras se acumula colchón: en una
  // parada por falta de datos no habría nada que mostrar al pulsarlo.
  const skip = document.getElementById("spinnerSkip");
  if (skip) skip.hidden = !(show && skippable);
}

function setLoginStatus(message) {
  const loginError = document.getElementById("loginError");
  if (loginError) loginError.textContent = message || "";
}

function nativeTvFlag() {
  try {
    const n = window.StreamBoxNative;
    if (n && typeof n.isTv !== "undefined") return !!n.isTv;
  } catch (e) {}
  return null;
}

function isNativeApp() {
  try {
    const cap = window.Capacitor;
    if (cap && (typeof cap.isNativePlatform === "function" ? cap.isNativePlatform() : cap.isNative)) return true;
  } catch (e) {}
  try {
    const n = window.StreamBoxNative;
    if (n && (n.hasExo || n.exo || n.hasVlc)) return true;
  } catch (e) {}
  return false;
}

function detectDevice() {
  const ua = navigator.userAgent || "";
  const nativeTv = nativeTvFlag();
  const isFireTV = /AFT|AmazonWebAppPlatform|Silk/i.test(ua);
  const isAndroidTV = /Android/i.test(ua) && /(TV|AOSP)/i.test(ua);
  const markedTv = /StreamBoxTV|Leanback/i.test(ua);
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const noHover = window.matchMedia("(hover: none)").matches;
  const w = Math.max(window.innerWidth || 0, (window.screen && screen.width) || 0);
  const h = Math.max(window.innerHeight || 0, (window.screen && screen.height) || 0);
  const wide = w >= 960;
  const landscape = w >= h && w >= 900;
  const heuristicTV =
    isFireTV ||
    isAndroidTV ||
    markedTv ||
    (coarse && noHover && wide && h >= 500) ||
    (landscape && (markedTv || isNativeApp() || /Android/i.test(ua)));
  const isTV = nativeTv === true || (nativeTv !== false && heuristicTV);
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isMobile = !isTV && window.innerWidth <= 768;
  document.body.classList.toggle("is-tv", isTV);
  document.body.classList.toggle("is-mobile", isMobile);
  document.body.classList.toggle("is-ios", isIOS);
  document.body.classList.toggle("is-touch", coarse || "ontouchstart" in window);
  document.documentElement.classList.toggle(
    "is-native-tv",
    nativeTv === true || (isTV && (markedTv || isNativeApp() || landscape))
  );
  document.documentElement.classList.toggle("login-landscape", landscape);
  if (!isTV) document.body.classList.remove("tv-channels-open");
  applyTvChrome();
}

async function refreshNativeTvFlag() {
  try {
    const cap = window.Capacitor;
    const plugin = cap && cap.Plugins && cap.Plugins.StreamBox;
    if (!plugin || typeof plugin.getInfo !== "function") return;
    const info = await plugin.getInfo();
    if (!info) return;
    window.StreamBoxNative = Object.assign({}, window.StreamBoxNative || {}, info, {
      isTv: !!info.isTv,
      hasExo: true,
      exo: true,
      hasVlc: true,
    });
    detectDevice();
    applyUiMode();
    initNativeEnginePicker();
  } catch (e) {}
}

detectDevice();

function isTvLayout() {
  return document.body.classList.contains("is-tv");
}

function getTvHeaderActions() {
  return [document.getElementById("refreshBtn"), document.getElementById("logoutBtn")].filter(Boolean);
}

function applyTvChrome() {
  const tv = isTvLayout();
  const hideIds = ["displayBtn", "pipBtn", "airplayBtn", "castButton", "bufferSelect", "channelSearch", "sortBtn", "stopBtn", "goLiveBtn"];
  hideIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.tabIndex = tv ? -1 : 0;
  });
  const bufferLabel = document.querySelector(".buffer-control");
  if (bufferLabel) bufferLabel.setAttribute("aria-hidden", tv ? "true" : "false");
  getTvHeaderActions().forEach((btn) => {
    btn.tabIndex = 0;
  });
  document.querySelectorAll(".category-btn").forEach((btn) => {
    btn.tabIndex = tv ? -1 : 0;
  });
  if (video) {
    if (tv) video.removeAttribute("controls");
    else video.setAttribute("controls", "");
  }
  if (tv) document.body.classList.add("tv-channels-open");
}

function rememberLastList(payload) {
  if (!payload) return;
  try {
    localStorage.setItem(LAST_LIST_KEY, typeof payload === "string" ? payload : JSON.stringify(payload));
  } catch (e) {}
}

function peekLastList() {
  try {
    return JSON.parse(localStorage.getItem(LAST_LIST_KEY) || "null");
  } catch (e) {
    return null;
  }
}

function getLogoutAt() {
  try {
    return parseInt(sessionStorage.getItem(LOGOUT_AT_KEY) || "0", 10) || 0;
  } catch (e) {
    return 0;
  }
}

function assignmentIsStale(data) {
  const logoutAt = getLogoutAt();
  if (!logoutAt) return false;
  const ts = data && data.ts != null ? Number(data.ts) : 0;
  // Sin ts (ficheros antiguos) no bloqueamos: si no, la TV ve la lista y nunca entra.
  if (!ts) return false;
  return ts <= logoutAt;
}

function setTvChannelsOpen(open) {
  if (!isTvLayout()) {
    document.body.classList.remove("tv-channels-open");
    return;
  }
  document.body.classList.add("tv-channels-open");
}

function focusTvCategoryColumn() {
  const categories = document.querySelectorAll(".category-btn");
  const activeIndex = Array.from(categories).findIndex((c) => c.classList.contains("active"));
  currentFocus.col = 0;
  currentFocus.row = activeIndex >= 0 ? activeIndex : 0;
  const active = document.activeElement;
  if (active && getTvHeaderActions().indexOf(active) >= 0) active.blur();
}

function focusTvHeader(index) {
  const actions = getTvHeaderActions();
  if (!actions.length) return;
  const i = Math.max(0, Math.min(actions.length - 1, index == null ? 0 : index));
  currentFocus.col = TV_HEADER_COL;
  currentFocus.row = i;
  const btn = actions[i];
  if (btn && typeof btn.focus === "function") {
    try {
      btn.focus({ preventScroll: true });
    } catch (e) {
      btn.focus();
    }
  }
}

function enterTvChannelsColumn() {
  currentFocus.col = 1;
  const playing = virtualList.findIndex((ch) => ch && String(ch.id) === String(currentlyPlayingId));
  currentFocus.row = playing >= 0 ? playing : 0;
  ensureTvChannelVisible();
}

function ensureTvChannelVisible() {
  if (!channelsContainer || !virtualList.length) return;
  const cols = channelGridCols();
  const rowH = channelGridRowHeight();
  const view = Math.max(channelsContainer.clientHeight || 0, rowH);
  const gridRow = Math.floor(currentFocus.row / cols);
  const y = gridRow * rowH;
  if (y < channelsContainer.scrollTop) channelsContainer.scrollTop = y;
  else if (y + rowH > channelsContainer.scrollTop + view) channelsContainer.scrollTop = y + rowH - view;
  paintVirtualWindow();
}

// Prefijos de proveedor: solo se quitan en pantalla, no en datos ni búsqueda.
function displayName(str) {
  return String(str || "")
    .replace(/^ES:\s*/i, "")
    .replace(/^EU\|ES\s*/i, "");
}

function displayCategoryName(str) {
  return displayName(str).replace(/^ES\s+/i, "");
}

function extractQualityHint(name) {
  const n = String(name || "");
  if (/\b(4K|2160p|UHD)\b/i.test(n)) return "4K";
  if (/\b(1080p?|FHD|Full\s*HD)\b/i.test(n)) return "1080p";
  if (/\b(720p?|HD)\b/i.test(n)) return "720p";
  if (/\bSD\b/i.test(n)) return "SD";
  return "";
}

function getBufferSeconds() {
  const raw = localStorage.getItem(BUFFER_KEY);
  const n = parseInt(raw == null ? String(DEFAULT_BUFFER_SECONDS) : raw, 10);
  // El 0 es válido: significa arrancar sin esperar a acumular nada.
  if (isNaN(n) || n < 0) return DEFAULT_BUFFER_SECONDS;
  return Math.min(90, n);
}

function setBufferSeconds(value) {
  const n = Math.min(90, Math.max(0, parseInt(value, 10) || 0));
  localStorage.setItem(BUFFER_KEY, String(n));
  return n;
}

// Los motores necesitan un techo de buffer razonable aunque no se quiera
// esperar al arrancar; son cosas distintas.
function getEngineBufferSeconds() {
  return Math.max(getBufferSeconds(), 10);
}

function stopPlayback(opts) {
  // Vaciar el <video> dispara un evento de error propio; sin esta marca el
  // reconector lo confundiría con una caída del stream.
  teardownInProgress = true;
  prebufferActive = false;
  clearPrebuffer();
  clearTimeout(teardownTimer);
  teardownTimer = setTimeout(() => {
    teardownInProgress = false;
  }, 400);

  if (!(opts && opts.keepNative)) nativePlayerStop();

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
  const stayOnMain =
    name === "login" &&
    !logoutRequested &&
    liveSession &&
    (channelsData.length > 0 || !!(currentUser && (currentUser.m3uUrl || currentUser.username))) &&
    (isTvLayout() || isNativeApp() || nativeTvFlag() === true);
  if (stayOnMain) return;

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
  if (showLogin) initTvLoginFocus();
}

/********** INTRO **********/
const SPLASH_MS = 4200;

function canAutoLoginFromCache() {
  try {
    const saved = JSON.parse(localStorage.getItem("xtream_user") || "null");
    return !!(saved && ((saved.pwEnc && saved.pwIv) || (saved.username && saved.password) || saved.m3uUrl));
  } catch (e) {
    return false;
  }
}

const VAULT_KEY = "streambox_vk";
const SESSION_KEY = "xtream_user";
const UI_KEY = "streambox_ui";
const ENGINE_KEY = "streambox_native_engine";
const signCache = new Map();
let playGen = 0;
let virtualList = [];
let virtualRange = { start: -1, end: -1, cols: 0 };

function bytesToB64(bytes) {
  const arr = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

function b64ToBytes(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function vaultKey() {
  if (!window.crypto || !crypto.subtle) return null;
  let raw = localStorage.getItem(VAULT_KEY);
  if (!raw) {
    raw = bytesToB64(crypto.getRandomValues(new Uint8Array(32)));
    localStorage.setItem(VAULT_KEY, raw);
  }
  return crypto.subtle.importKey("raw", b64ToBytes(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function sealSecret(plain) {
  if (!plain) return {};
  const key = await vaultKey();
  if (!key) return { password: plain };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(plain));
  return { pwEnc: bytesToB64(ct), pwIv: bytesToB64(iv) };
}

async function openSecret(saved) {
  if (!saved) return "";
  if (saved.password) return saved.password;
  if (!saved.pwEnc || !saved.pwIv) return "";
  try {
    const key = await vaultKey();
    if (!key) return "";
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(saved.pwIv) },
      key,
      b64ToBytes(saved.pwEnc)
    );
    return new TextDecoder().decode(pt);
  } catch (e) {
    return "";
  }
}

async function saveSession(user) {
  if (!user) return;
  const copy = {
    username: user.username,
    server: user.server,
    isM3U: !!user.isM3U,
    m3uUrl: user.m3uUrl || "",
    listKey: listCacheKey(user),
  };
  if (!user.isM3U && user.password) {
    const sealed = await sealSecret(user.password);
    if (sealed.password) copy.password = sealed.password;
    else {
      copy.pwEnc = sealed.pwEnc;
      copy.pwIv = sealed.pwIv;
    }
  }
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(copy));
    rememberLastList(copy);
  } catch (e) {}
}

async function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!saved) return null;
    if (!saved.isM3U) saved.password = await openSecret(saved);
    return saved;
  } catch (e) {
    return null;
  }
}

function listCacheKey(user) {
  if (!user) return "";
  if (user.isM3U) return "m3u:" + (user.m3uUrl || "");
  return "xt:" + (user.server || "") + ":" + (user.username || "");
}

function openListDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("no"));
      return;
    }
    const req = indexedDB.open("streambox-lists", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("lists")) req.result.createObjectStore("lists");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function writeListCache(user, text) {
  try {
    const db = await openListDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("lists", "readwrite");
      tx.objectStore("lists").put({ text: text, at: Date.now() }, listCacheKey(user));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {}
}

async function readListCache(user) {
  try {
    const db = await openListDb();
    const row = await new Promise((resolve, reject) => {
      const tx = db.transaction("lists", "readonly");
      const req = tx.objectStore("lists").get(listCacheKey(user));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!row || !row.text) return null;
    if (Date.now() - row.at > 7 * 24 * 3600 * 1000) return null;
    return row.text;
  } catch (e) {
    return null;
  }
}

function loadSavedListsRegistry() {
  try {
    const raw = localStorage.getItem(SAVED_LISTS_KEY);
    savedLists = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(savedLists)) savedLists = [];
  } catch (e) {
    savedLists = [];
  }
  try {
    activeListId = localStorage.getItem(ACTIVE_LIST_KEY) || null;
  } catch (e) {
    activeListId = null;
  }
}

function persistSavedLists() {
  try {
    localStorage.setItem(SAVED_LISTS_KEY, JSON.stringify(savedLists));
  } catch (e) {}
}

function setActiveListId(id) {
  activeListId = id || null;
  try {
    if (activeListId) localStorage.setItem(ACTIVE_LIST_KEY, activeListId);
    else localStorage.removeItem(ACTIVE_LIST_KEY);
  } catch (e) {}
}

function defaultListName(user, fromUpload) {
  if (fromUpload && String(fromUpload).trim()) return String(fromUpload).trim();
  if (user && user.isM3U && user.m3uUrl) {
    try {
      return new URL(user.m3uUrl).hostname.replace(/^www\./, "");
    } catch (e) {}
    return "Lista M3U";
  }
  if (user && user.username && user.username !== "Invitado M3U") return user.username;
  return "Mi lista";
}

function currentListMeta(prefixId) {
  if (activeListId === ALL_LISTS_ID) return { listId: "", listName: "", prefixId: false };
  const entry = savedLists.find((l) => l.id === activeListId);
  if (entry) return { listId: entry.id, listName: entry.name, prefixId: !!prefixId };
  if (pendingListName) return { listId: activeListId || "", listName: pendingListName, prefixId: !!prefixId };
  return { listId: activeListId || "", listName: "", prefixId: !!prefixId };
}

function tagChannelsWithList(entry) {
  if (!entry) return;
  const apply = (ch) => {
    if (!ch) return;
    ch.listId = entry.id;
    ch.listName = entry.name;
  };
  channelsData.forEach(apply);
  channelById.forEach(apply);
  Object.keys(categoriesData).forEach((cat) => categoriesData[cat].forEach(apply));
}

async function listEntryToUser(entry) {
  const user = {
    username: entry.username || "",
    server: entry.server || "",
    isM3U: !!entry.isM3U,
    m3uUrl: entry.m3uUrl || "",
    listKey: entry.listKey || listCacheKey(entry),
  };
  if (!entry.isM3U) user.password = entry.password || (await openSecret(entry));
  return user;
}

async function upsertSavedList(user, name) {
  if (!user) return null;
  const listKey = listCacheKey(user);
  let entry = savedLists.find((l) => l.listKey === listKey);
  if (entry) {
    if (name) entry.name = String(name).trim() || entry.name;
    entry.username = user.username || entry.username;
    entry.server = user.server || entry.server;
    entry.m3uUrl = user.m3uUrl || entry.m3uUrl;
    entry.isM3U = !!user.isM3U;
    entry.updatedAt = Date.now();
  } else {
    entry = {
      id: "list_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: (name && String(name).trim()) || defaultListName(user),
      listKey: listKey,
      isM3U: !!user.isM3U,
      username: user.username || "",
      server: user.server || "",
      m3uUrl: user.m3uUrl || "",
      addedAt: Date.now(),
    };
    if (!user.isM3U && user.password) {
      const sealed = await sealSecret(user.password);
      if (sealed.password) entry.password = sealed.password;
      else {
        entry.pwEnc = sealed.pwEnc;
        entry.pwIv = sealed.pwIv;
      }
    }
    savedLists.push(entry);
  }
  persistSavedLists();
  return entry;
}

async function migrateSavedListsFromSession() {
  loadSavedListsRegistry();
  if (savedLists.length) return;
  const saved = await loadSession();
  if (!saved || !((saved.username && saved.password) || saved.m3uUrl)) return;
  const entry = await upsertSavedList(saved, defaultListName(saved));
  if (entry && !activeListId) setActiveListId(entry.id);
}

function removeSavedList(id) {
  savedLists = savedLists.filter((l) => l.id !== id);
  persistSavedLists();
  if (activeListId === id) {
    setActiveListId(savedLists.length ? savedLists[0].id : null);
  }
}

function renameSavedList(id, name) {
  const entry = savedLists.find((l) => l.id === id);
  if (!entry || !name) return;
  entry.name = String(name).trim() || entry.name;
  persistSavedLists();
}

async function loadAllListsMerged() {
  const merged = [];
  const cats = {};
  const byId = new Map();
  let chno = 1;
  for (const entry of savedLists) {
    const user = await listEntryToUser(entry);
    const text = await readListCache(user);
    if (!text || detectProviderListError(text)) continue;
    parseM3U(text, { listId: entry.id, listName: entry.name, prefixId: true });
    channelsData.forEach((ch) => {
      ch.chno = chno++;
      merged.push(ch);
      byId.set(ch.id, ch);
      if (!cats[ch.category]) cats[ch.category] = [];
      cats[ch.category].push(ch);
    });
  }
  channelsData = merged;
  categoriesData = cats;
  channelById = byId;
  epgResolvedIds = {};
}

async function switchToList(listId) {
  if (!listId || listId === activeListId) return;
  const prevListId = activeListId;
  const prevUser = currentUser;
  const snap = snapshotChannelState();
  setActiveListId(listId);
  showSpinner(true, "Cargando lista…");
  try {
    if (listId === ALL_LISTS_ID) {
      await loadAllListsMerged();
      if (!channelsData.length) throw new Error("No hay listas en caché");
      currentUser = { username: "Todas las listas", isM3U: true, isMerged: true };
    } else {
      const entry = savedLists.find((l) => l.id === listId);
      if (!entry) throw new Error("Lista no encontrada");
      const user = await listEntryToUser(entry);
      currentUser = user;
      currentServer = user.server || "";
      await saveSession(currentUser);
      const cached = await readListCache(user);
      if (cached && !detectProviderListError(cached)) {
        parseM3U(cached, currentListMeta(false));
        tagChannelsWithList(entry);
      }
      if (!channelsData.length) {
        const ok = await performLoginAction(user.server, user.username, user.password, user.m3uUrl, entry.name, {
          noActivate: true,
        });
        if (!ok && !channelsData.length) throw new Error("No se pudo cargar la lista");
      }
    }
    searchQuery = "";
    const search = document.getElementById("channelSearch");
    if (search) search.value = "";
    renderCategories();
    const names = listCategoryNames();
    if (names[0]) selectCategory(names[0]);
    renderListSelector();
    const label =
      listId === ALL_LISTS_ID ? "Todas las listas" : (savedLists.find((l) => l.id === listId) || {}).name || "Lista";
    showToast("Mostrando: " + label);
  } catch (e) {
    setActiveListId(prevListId);
    currentUser = prevUser;
    restoreChannelState(snap);
    showToast((e && e.message) || "Error al cambiar de lista");
  } finally {
    showSpinner(false);
  }
}

function renderListSelector() {
  const sel = document.getElementById("listSelect");
  if (sel) {
    sel.hidden = true;
    sel.innerHTML = "";
  }
  const listsBtn = document.getElementById("listsBtn");
  if (listsBtn) listsBtn.hidden = true;
  updateChannelColumnTitle();
}

function updateChannelColumnTitle() {
  const title = document.getElementById("channelColumnTitle");
  if (!title) return;
  if (searchQuery) return;
  title.textContent = "Canales";
}

function renderListsManagePanel() {
  const ul = document.getElementById("listsManageList");
  if (!ul) return;
  ul.innerHTML = "";
  savedLists.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "lists-manage-item";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "lists-rename-input";
    nameInput.value = entry.name;
    nameInput.title = "Nombre de la lista";
    nameInput.addEventListener("change", () => {
      renameSavedList(entry.id, nameInput.value);
      renderListSelector();
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "lists-del-btn";
    delBtn.textContent = "Eliminar";
    delBtn.title = "Quitar esta lista guardada";
    delBtn.addEventListener("click", () => {
      if (savedLists.length <= 1) {
        showToast("Debe quedar al menos una lista");
        return;
      }
      removeSavedList(entry.id);
      renderListsManagePanel();
      renderListSelector();
      if (activeListId === entry.id || !savedLists.some((l) => l.id === activeListId)) {
        switchToList(savedLists[0] ? savedLists[0].id : null);
      }
    });
    li.appendChild(nameInput);
    li.appendChild(delBtn);
    ul.appendChild(li);
  });
}

function showListsOverlay(show) {
  const overlay = document.getElementById("listsOverlay");
  if (!overlay) return;
  if (show) {
    renderListsManagePanel();
    overlay.hidden = false;
    overlay.classList.add("is-open");
  } else {
    overlay.classList.remove("is-open");
    overlay.hidden = true;
    stopAddListPolling();
  }
}

function stopAddListPolling() {
  listAddPollGen++;
  if (listAddPollTimer) {
    clearInterval(listAddPollTimer);
    listAddPollTimer = null;
  }
}

function startAddListPolling() {
  stopAddListPolling();
  const myGen = listAddPollGen;
  const deviceId = showDeviceId();
  const qrBox = document.getElementById("listsAddQr");
  if (qrBox) {
    const base = (window.location.origin + window.location.pathname).replace(/[^/]*$/, "");
    renderUploadQr(base + "upload.php?id=" + encodeURIComponent(deviceId), "listsAddQr");
  }
  async function tick() {
    if (myGen !== listAddPollGen) return;
    try {
      const res = await fetch("api_dispositivos.php?id=" + encodeURIComponent(deviceId));
      const data = await res.json();
      if (myGen !== listAddPollGen) return;
      if (!data || data.status === "esperando" || !(data.serverUrl || data.m3uUrl)) return;
      if (assignmentIsStale(data)) return;
      stopAddListPolling();
      showListsOverlay(false);
      await performLoginAction(data.serverUrl, data.username, data.password, data.m3uUrl, data.listName);
      showToast("Lista añadida");
    } catch (e) {}
  }
  tick();
  listAddPollTimer = setInterval(tick, 5000);
}

function initListManager() {
  loadSavedListsRegistry();
  const sel = document.getElementById("listSelect");
  if (sel) {
    sel.addEventListener("change", () => {
      if (sel.value) switchToList(sel.value);
    });
  }
  const listsBtn = document.getElementById("listsBtn");
  if (listsBtn) {
    listsBtn.addEventListener("click", () => showListsOverlay(true));
  }
  const closeBtn = document.getElementById("listsCloseBtn");
  if (closeBtn) closeBtn.addEventListener("click", () => showListsOverlay(false));
  const addBtn = document.getElementById("listsAddBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      const addPanel = document.getElementById("listsAddPanel");
      if (addPanel) addPanel.hidden = !addPanel.hidden;
      if (addPanel && !addPanel.hidden) startAddListPolling();
      else stopAddListPolling();
    });
  }
  const overlay = document.getElementById("listsOverlay");
  if (overlay) {
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) showListsOverlay(false);
    });
  }
}

async function signedStreamHref(url) {
  const now = Math.floor(Date.now() / 1000);
  const hit = signCache.get(url);
  if (hit && hit.exp - 90 > now) return hit.href;
  const unsigned = "stream.php?url=" + encodeURIComponent(url);
  try {
    const res = await fetch("sign.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!data || !data.ok || !data.href) throw new Error((data && data.error) || "sin firma");
    signCache.set(url, { href: data.href, exp: data.exp });
    return data.href;
  } catch (e) {
    logPlayback("firma", "sign.php no disponible, se usa el relé sin firmar");
    return unsigned;
  }
}

function applyUiMode() {
  if (isTvLayout()) {
    document.body.classList.remove("ui-large", "ui-contrast");
    return;
  }
  const mode = localStorage.getItem(UI_KEY) || "normal";
  document.body.classList.toggle("ui-large", mode === "large" || mode === "contrast");
  document.body.classList.toggle("ui-contrast", mode === "contrast");
}

function cycleUiMode() {
  const order = ["normal", "large", "contrast"];
  const cur = localStorage.getItem(UI_KEY) || "normal";
  const next = order[(order.indexOf(cur) + 1) % order.length];
  localStorage.setItem(UI_KEY, next);
  applyUiMode();
  paintVirtualWindow(true);
  showToast(next === "normal" ? "Texto normal" : next === "large" ? "Texto grande" : "Alto contraste");
}

function isSplashActive() {
  const html = document.documentElement;
  return (
    html.classList.contains("needs-splash") &&
    !html.classList.contains("splash-done") &&
    !html.classList.contains("splash-leaving")
  );
}

function dismissSplash(instant) {
  const html = document.documentElement;
  if (html.classList.contains("splash-done")) return;
  if (!html.classList.contains("needs-splash")) {
    html.classList.add("splash-done");
    initTvLoginFocus();
    return;
  }
  if (instant) {
    html.classList.add("splash-done");
    html.classList.remove("needs-splash", "splash-leaving");
    initTvLoginFocus();
    return;
  }
  if (html.classList.contains("splash-leaving")) return;
  html.classList.add("splash-leaving");
  window.setTimeout(() => {
    html.classList.add("splash-done");
    html.classList.remove("needs-splash", "splash-leaving");
    initTvLoginFocus();
  }, 600);
}

function initSplash() {
  const html = document.documentElement;
  html.classList.add("needs-splash");
  html.classList.remove("splash-done", "splash-leaving");
  if (canAutoLoginFromCache()) html.classList.add("has-session");
  const splash = document.getElementById("splashScreen");
  if (!splash) {
    html.classList.add("splash-done");
    html.classList.remove("needs-splash");
    return;
  }
  splash.addEventListener("click", () => dismissSplash());
  window.setTimeout(() => dismissSplash(), SPLASH_MS);
  prefetchEPG();
}

/********** DEVICE ID & CARGA REMOTA **********/
function getDeviceId() {
  const KEY = "device_id";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      try {
        id = sessionStorage.getItem(KEY);
      } catch (e) {}
    }
    if (!id) {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      id = "";
      for (let i = 0; i < 6; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
      id = id.match(/.{1,2}/g).join("-");
    }
    localStorage.setItem(KEY, id);
    try {
      sessionStorage.setItem(KEY, id);
    } catch (e) {}
    return id;
  } catch (e) {
    if (!getDeviceId._mem) {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let id = "";
      for (let i = 0; i < 6; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
      getDeviceId._mem = id.match(/.{1,2}/g).join("-");
    }
    return getDeviceId._mem;
  }
}

/**
 * Dibuja el QR de carga remota. Lleva el Device ID dentro de la URL, así que
 * escanearlo abre el formulario con el dispositivo ya elegido y en el móvil
 * solo queda pegar la lista: teclear ese código en una tele es lo más incómodo
 * de todo el proceso.
 */
function renderUploadQr(url, canvasId) {
  const canvas = document.getElementById(canvasId || "uploadQr");
  if (!canvas || typeof qrcode === "undefined") return;
  try {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();

    const modulos = qr.getModuleCount();
    const ctx = canvas.getContext("2d");
    // Margen obligatorio del formato: sin zona de silencio muchos lectores no
    // llegan a reconocer el código.
    const quiet = 2;
    const escala = Math.max(1, Math.floor(canvas.width / (modulos + quiet * 2)));
    const lado = escala * (modulos + quiet * 2);
    canvas.width = lado;
    canvas.height = lado;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, lado, lado);
    ctx.fillStyle = "#000000";
    for (let f = 0; f < modulos; f++) {
      for (let c = 0; c < modulos; c++) {
        if (qr.isDark(f, c)) {
          ctx.fillRect((c + quiet) * escala, (f + quiet) * escala, escala, escala);
        }
      }
    }
    canvas.hidden = false;
  } catch (e) {
    canvas.hidden = true;
  }
}

function showDeviceId() {
  const deviceId = getDeviceId();
  const displayEl = document.getElementById("deviceIdDisplay");
  if (displayEl) displayEl.textContent = deviceId;
  const base = (window.location.origin + window.location.pathname).replace(/[^/]*$/, "");
  const uploadUrl = base + "upload.php";
  const uploadUrlEl = document.getElementById("uploadUrlDisplay");
  if (uploadUrlEl) uploadUrlEl.textContent = uploadUrl;
  renderUploadQr(uploadUrl + "?id=" + encodeURIComponent(deviceId));
  return deviceId;
}

function stopRemotePolling() {
  remotePollGen++;
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

function markSessionLive() {
  liveSession = true;
  logoutRequested = false;
  stopRemotePolling();
}

function snapshotChannelState() {
  return {
    channels: channelsData.slice(),
    categories: categoriesData,
    byId: channelById,
  };
}

function restoreChannelState(snap) {
  if (!snap || !snap.channels || !snap.channels.length) return false;
  channelsData = snap.channels;
  categoriesData = snap.categories || {};
  channelById = snap.byId || new Map(snap.channels.map((ch) => [ch.id, ch]));
  return true;
}

function applyListOrKeep(text) {
  const snap = snapshotChannelState();
  parseM3U(text, currentListMeta(false));
  if (channelsData.length) return true;
  if (restoreChannelState(snap)) {
    showToast("No se pudo actualizar la lista; se mantiene la anterior");
    return true;
  }
  return false;
}

function enterChannelView(user) {
  try {
    finishLogin(user);
  } catch (e) {
    if (channelsData.length) {
      showToast((e && e.message) || "Error al entrar");
    } else {
      throw e;
    }
  }
  if (channelsData.length) markSessionLive();
  try {
    const entry = savedLists.find((l) => l.id === activeListId);
    if (entry && activeListId !== ALL_LISTS_ID) tagChannelsWithList(entry);
    renderCategories();
    renderListSelector();
    updateChannelColumnTitle();
  } catch (e) {
    showToast("Error al mostrar canales");
  }
  try {
    if (!currentlyPlayingId) restoreLastChannel();
  } catch (e) {}
}

function startRemotePolling() {
  if (liveSession && channelsData.length && !logoutRequested) return;
  const deviceId = showDeviceId();
  stopRemotePolling();
  const myGen = remotePollGen;

  async function tick() {
    if (myGen !== remotePollGen) return;
    if (remoteLoginBusy) return;
    if (liveSession && channelsData.length && !logoutRequested) {
      stopRemotePolling();
      return;
    }
    try {
      const res = await fetch("api_dispositivos.php?id=" + encodeURIComponent(deviceId));
      const data = await res.json();
      if (myGen !== remotePollGen) return;
      if (liveSession && channelsData.length && !logoutRequested) return;
      if (!data || data.status === "esperando" || !(data.serverUrl || data.m3uUrl)) return;
      if (assignmentIsStale(data)) {
        setLoginStatus("Hay una lista antigua. Vuelve a enviarla desde el móvil (o pulsa Recargar).");
        return;
      }
      try {
        sessionStorage.removeItem(LOGOUT_AT_KEY);
      } catch (e) {}
      setLoginStatus("Lista recibida. Cargando canales…");
      remoteLoginBusy = true;
      try {
        const ok = await performLoginAction(data.serverUrl, data.username, data.password, data.m3uUrl, data.listName);
        if (ok || liveSession || channelsData.length) stopRemotePolling();
        else if (!loginCancelled) {
          const errEl = document.getElementById("loginError");
          setLoginStatus((errEl && errEl.textContent) || "No se pudieron cargar los canales.");
        }
      } finally {
        remoteLoginBusy = false;
        if (liveSession) stopRemotePolling();
      }
    } catch (e) {
      setLoginStatus((e && e.message) || "Error al leer la lista remota.");
    }
  }

  tick();
  pollingInterval = setInterval(tick, 5000);
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
async function performLoginAction(serverUrl, username, password, m3uUrl, listName, opts) {
  loginCancelled = false;
  pendingListName = listName ? String(listName).trim() : null;
  setLoginStatus("Descargando lista... Por favor espera.");
  showSpinner(true, "Conectando...");

  serverUrl = (serverUrl || "").trim();
  username = (username || "").trim();
  password = (password || "").trim();
  m3uUrl = (m3uUrl || "").trim();

  // Xtream si hay usuario+clave. M3U solo si no hay Xtream (evita basura de autocompletado).
  const hasXtream = !!(username && password);
  const useM3u = !hasXtream && !!m3uUrl;
  if (hasXtream && !serverUrl) {
    serverUrl = "http://masquecero.net";
  }

  try {
    if (useM3u) {
      try {
        currentServer = new URL(m3uUrl).origin;
      } catch (err) {}
      currentUser = { username: "Invitado M3U", isM3U: true, m3uUrl: m3uUrl, server: currentServer };
      await saveSession(currentUser);
      const cachedM3u = await readListCache(currentUser);
      if (cachedM3u && !detectProviderListError(cachedM3u)) {
        parseM3U(cachedM3u, currentListMeta(false));
        if (channelsData.length) {
          enterChannelView(currentUser);
          showSpinner(true, "Actualizando lista...");
        }
      }

      const response = await fetch("xtream_proxy.php?direct_url=" + encodeURIComponent(m3uUrl));
      const m3uContent = await response.text();
      if (loginCancelled) return liveSession && channelsData.length > 0;
      if (m3uContent.includes("Error al cargar") || m3uContent.trim() === "") {
        if (channelsData.length) {
          showSpinner(false);
          markSessionLive();
          return true;
        }
        throw new Error("No se pudo cargar la URL.");
      }
      if (m3uContent.trim().charAt(0) === "{" || /<!DOCTYPE|<html/i.test(m3uContent)) {
        let msg = "No se pudo cargar la URL.";
        try {
          const err = JSON.parse(m3uContent);
          if (err && err.message) msg = err.message;
        } catch (e) {}
        if (channelsData.length) {
          showSpinner(false);
          markSessionLive();
          return true;
        }
        throw new Error(msg);
      }
      const listaConError = detectProviderListError(m3uContent);
      if (!applyListOrKeep(m3uContent)) {
        throw new Error(
          listaConError ? "El proveedor responde: " + listaConError : "La lista no contiene canales"
        );
      }
      await saveSession(currentUser);
      await writeListCache(currentUser, m3uContent);
      const entry = await upsertSavedList(currentUser, listName || defaultListName(currentUser, listName));
      tagChannelsWithList(entry);
      pendingListName = null;
      if (!(opts && opts.noActivate) && entry && !(activeListId === ALL_LISTS_ID && savedLists.length > 1)) {
        setActiveListId(entry.id);
      }
      if (activeListId === ALL_LISTS_ID && savedLists.length > 1) {
        await loadAllListsMerged();
        currentUser = { username: "Todas las listas", isM3U: true, isMerged: true };
      }
      enterChannelView(currentUser);
      renderListSelector();
      checkAccountExpiryFromChannels();
      showSpinner(false);
      return true;
    }

    if (hasXtream) {
      currentServer = serverUrl;
      const pendingUser = { username, password, server: serverUrl, isM3U: false };
      const cachedXt = await readListCache(pendingUser);
      if (cachedXt && !detectProviderListError(cachedXt)) {
        parseM3U(cachedXt, currentListMeta(false));
        if (channelsData.length) {
          currentUser = pendingUser;
          await saveSession(currentUser);
          enterChannelView(currentUser);
          showSpinner(true, "Comprobando cuenta...");
        }
      }

      showSpinner(true, "Validando acceso...");
      const response = await fetchXtream("player_api.php", { username, password }, serverUrl);
      const rawText = await response.text();
      if (loginCancelled) return liveSession && channelsData.length > 0;
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
      await saveSession(currentUser);
      setLoginStatus("Descargando canales...");
      showSpinner(true, "Descargando canales...");
      await loadM3UFromXtream();
      const entry = await upsertSavedList(currentUser, listName || defaultListName(currentUser, listName));
      tagChannelsWithList(entry);
      pendingListName = null;
      if (!(opts && opts.noActivate) && entry && !(activeListId === ALL_LISTS_ID && savedLists.length > 1)) {
        setActiveListId(entry.id);
      }
      if (activeListId === ALL_LISTS_ID && savedLists.length > 1) {
        await loadAllListsMerged();
        currentUser = { username: "Todas las listas", isM3U: true, isMerged: true };
      }
      enterChannelView(currentUser);
      renderListSelector();
      if (currentServer.includes("acortador.vip")) checkAccountExpiryFromChannels();
      showSpinner(false);
      return true;
    }

    throw new Error("Escanea el QR para cargar la lista.");
  } catch (error) {
    pendingListName = null;
    showSpinner(false);
    const msg = (error && error.message) || "Error al iniciar sesión.";
    setLoginStatus(msg);
    if (liveSession || channelsData.length) {
      showToast(msg);
      if (channelsData.length) markSessionLive();
      const main = document.getElementById("mainScreen");
      if (main && !main.classList.contains("active") && channelsData.length) {
        try {
          showScreen("main");
        } catch (e) {}
      }
      return false;
    }
    showScreen("login");
    startRemotePolling();
    return false;
  }
}

/********** AUTO-LOGIN **********/
function cancelLogin() {
  loginCancelled = true;
  showSpinner(false);
  setLoginStatus("Entrada automática cancelada. Escanea el QR para cargar la lista.");
  startRemotePolling();
}

/**
 * Registra el service worker, que es lo que permite instalar la web como
 * aplicación en Android. Se hace tras la carga para no competir por la red con
 * la lista de canales, y cualquier fallo se ignora: es una mejora, no un
 * requisito para que el reproductor funcione.
 */
/**
 * Botón de instalación propio. Chrome dispara `beforeinstallprompt` cuando la
 * web cumple los requisitos, pero su aviso automático es discreto y se pierde;
 * con un botón visible en la pantalla de inicio se instala a la primera.
 */
function prepararInstalacion() {
  const boton = document.getElementById("installBtn");
  if (!boton) return;
  let peticion = null;

  window.addEventListener("beforeinstallprompt", (ev) => {
    // Sin esto Chrome muestra su propio aviso y competiría con el botón.
    ev.preventDefault();
    peticion = ev;
    boton.hidden = false;
  });

  boton.addEventListener("click", async () => {
    if (!peticion) return;
    boton.disabled = true;
    try {
      peticion.prompt();
      await peticion.userChoice;
    } catch (e) {}
    // La petición solo sirve una vez.
    peticion = null;
    boton.hidden = true;
    boton.disabled = false;
  });

  window.addEventListener("appinstalled", () => {
    peticion = null;
    boton.hidden = true;
  });
}

function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (isNativeApp() || nativeTvFlag() !== null) return;
  if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

function adSlotVisibleHere() {
  if (isTvLayout() || document.documentElement.classList.contains("is-native-tv")) return true;
  return window.matchMedia("(min-width: 1201px)").matches;
}

function initAdSlot() {
  const slot = document.getElementById("adSlot");
  const img = document.getElementById("adSlotImg");
  const link = document.getElementById("adSlotLink");
  if (!slot || !img || !link) return;
  slot.hidden = true;
  link.tabIndex = -1;
  img.tabIndex = -1;
  if (!adSlotVisibleHere()) return;

  fetch("ads_api.php")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const ads = data && Array.isArray(data.ads) ? data.ads : [];
      if (!ads.length) {
        slot.hidden = true;
        return;
      }
      let index = 0;
      let timer = null;
      const interval = Math.max(3000, parseInt(data.interval, 10) || 9000);

      function show(i) {
        const ad = ads[i];
        if (!ad || !ad.src) return;
        img.src = ad.src;
        if (ad.href) {
          link.href = ad.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        } else {
          link.removeAttribute("href");
          link.removeAttribute("target");
        }
      }

      function stop() {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      }

      function start() {
        if (timer || ads.length < 2) return;
        timer = setInterval(() => {
          index = (index + 1) % ads.length;
          show(index);
        }, interval);
      }

      show(0);
      slot.hidden = false;
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) stop();
        else start();
      });
      start();
    })
    .catch(() => {
      slot.hidden = true;
    });
}

window.addEventListener("DOMContentLoaded", () => {
  detectDevice();
  refreshNativeTvFlag();
  applyUiMode();
  initNativeEnginePicker();
  try {
    const session = localStorage.getItem(SESSION_KEY);
    if (session && !localStorage.getItem(LAST_LIST_KEY)) localStorage.setItem(LAST_LIST_KEY, session);
  } catch (e) {}
  initSplash();
  initChannelTools();
  initListManager();
  initAdSlot();
  registrarServiceWorker();
  prepararInstalacion();
  showDeviceId();
  initTvLoginFocus();
  // Siempre escuchar el QR; el auto-login no debe dejar la TV sin poll.
  startRemotePolling();

  loadSession().then(async (saved) => {
    await migrateSavedListsFromSession();
    if (!saved) return;
    const canAutoLogin = !!((saved.username && saved.password) || saved.m3uUrl);
    if (!canAutoLogin) return;

    setTimeout(() => {
      if (loginCancelled || liveSession || remoteLoginBusy) return;
      performLoginAction(saved.server, saved.username, saved.password, saved.m3uUrl).then((ok) => {
        if (ok || liveSession) stopRemotePolling();
      });
    }, 1200);
  });
});

window.addEventListener("resize", () => {
  detectDevice();
  applyUiMode();
  paintVirtualWindow(true);
  layoutNativePlayer();
});

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
  if (isTvLayout()) {
    focusTvCategoryColumn();
    updateCursorVisuals();
  }

  prefetchEPG();
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
      nativePlayerStop();
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

let epgFetchInFlight = null;

function prefetchEPG() {
  if (hasEPG() && Date.now() - epgLoadedAt < 10 * 60 * 1000) return epgFetchInFlight;
  return loadEPG();
}

/**
 * Pide la guía ya digerida a epg_api.php. El XMLTV completo se parsea en el
 * servidor: hacerlo aquí congelaba la interfaz durante segundos.
 */
async function loadEPG() {
  if (epgFetchInFlight) return epgFetchInFlight;
  epgFetchInFlight = (async () => {
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
    } finally {
      epgFetchInFlight = null;
    }
  })();
  return epgFetchInFlight;
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
  if (!channelsContainer) return;
  channelsContainer.querySelectorAll(".channel-item").forEach((item) => {
    const epgEl = item.querySelector(".channel-epg");
    if (!epgEl) return;
    const channel = channelById.get(item.dataset.id);
    if (!channel) return;
    if (searchQuery && channel.category) {
      epgEl.textContent = displayCategoryName(channel.category);
    } else if (hasEPG()) {
      epgEl.textContent = channelEpgLabel(channel);
    } else {
      epgEl.textContent = "";
    }
    epgEl.hidden = !epgEl.textContent;
  });
}

function formatChannelLiveStats() {
  return "";
}

function refreshVisibleChannelStats() {
  // Player M3U: sin resolución ni chips de lista/calidad en las filas.
}

function formatTime(date) {
  if (!date || isNaN(date.getTime())) return "--:--";
  return date.getHours().toString().padStart(2, "0") + ":" + date.getMinutes().toString().padStart(2, "0");
}

/********** CARGAR Y PARSEAR M3U **********/
/**
 * Solo error de proveedor cuando NO hay canales válidos (lista = un canal-falso).
 * Antes, un nombre con "Expirado"/"Inactivo" tumba toda la lista.
 */
function extractM3UEntries(content) {
  const lines = String(content || "").split(/\r\n|\n|\r/);
  const out = [];
  let pending = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().replace(/^["']|["']$/g, "");
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      if (pending) out.push(pending);
      const nameMatch = line.match(/,(.+)$/);
      pending = { name: nameMatch ? nameMatch[1].trim() : "Canal", url: "" };
      continue;
    }
    if (line.charAt(0) === "#") continue;
    if (pending) {
      pending.url = line;
      out.push(pending);
      pending = null;
    }
  }
  if (pending) out.push(pending);
  return out;
}

function isProviderErrorChannel(name, url) {
  const n = String(name || "").trim();
  const u = String(url || "").trim();
  if (/^error\s*:/i.test(n)) return true;
  if (isStreamUrl(u)) return false;
  if (/^(account|cuenta|usuario|user|subscription|suscripci[oó]n|lista)\b/i.test(n)) return true;
  if (/\b(expired|caducad[ao]|invalid|inactiv[ao]|suspendid[ao]|bloquead[ao])\b/i.test(n) && n.length < 96) {
    return true;
  }
  return false;
}

function detectProviderListError(content) {
  const entries = extractM3UEntries(content);
  if (!entries.length) return "";
  const valid = entries.filter((e) => isStreamUrl(e.url) && !isProviderErrorChannel(e.name, e.url));
  if (valid.length > 0) return "";
  const err = entries.find((e) => isProviderErrorChannel(e.name, e.url));
  if (err) return err.name.replace(/^error\s*:\s*/i, "").trim();
  if (entries.length <= 2) return (entries[0].name || "Lista vacía del proveedor").trim();
  return "";
}

async function loadM3UFromXtream() {
  const response = await fetchXtream("get.php", {
    username: currentUser.username,
    password: currentUser.password,
    type: "m3u_plus",
    output: "ts",
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("El proveedor rechaza la cuenta: usuario, contraseña o suscripción no válidos");
  }
  const m3uContent = await response.text();
  const trimmed = (m3uContent || "").trim();
  if (!trimmed || trimmed.charAt(0) === "{" || /<!DOCTYPE|<html/i.test(trimmed)) {
    throw new Error("No se pudo descargar la lista M3U");
  }
  if (!applyListOrKeep(m3uContent)) {
    const providerError = detectProviderListError(trimmed);
    throw new Error(providerError ? "El proveedor responde: " + providerError : "La lista no contiene canales");
  }
  await writeListCache(currentUser, m3uContent);
}

function isStreamUrl(line) {
  return /^(https?|rtmp[es]?|rtsps?|udp|rtp):\/\//i.test(line);
}

function parseM3U(content, listMeta) {
  listMeta = listMeta || {};
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
      const chnoMatch = line.match(/tvg-chno="([^"]+)"/i);
      const safeName = nameMatch ? nameMatch[1].trim() : "Canal";
      const category = groupMatch ? groupMatch[1] : "Sin categoría";
      const tvgId = tvgIdMatch ? tvgIdMatch[1] : "";
      const logo = logoMatch ? logoMatch[1].trim() : "";
      const parsedChno = chnoMatch ? parseInt(chnoMatch[1], 10) : 0;
      const idBase = (tvgId || "") + "|" + category + "|" + safeName + "|" + extinf;
      const stableId = "ch_" + idBase.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
      const channelId =
        listMeta.prefixId && listMeta.listId ? listMeta.listId + "::" + stableId : stableId;
      currentChannel = {
        name: safeName,
        category: category,
        tvgId: tvgId,
        logo: logo,
        chno: parsedChno > 0 ? parsedChno : 0,
        id: channelId,
        listId: listMeta.listId || "",
        listName: listMeta.listName || "",
        qualityHint: extractQualityHint(safeName),
      };
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
  channels.forEach((ch, i) => {
    if (!ch.chno) ch.chno = i + 1;
    channelById.set(ch.id, ch);
  });
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

/********** REGISTRO DE EVENTOS DEL CANAL **********/
const MAX_LOG_ENTRIES = 40;
let playbackLog = [];
let channelStartedAt = 0;

// Las URL de Xtream llevan el usuario y la contraseña dentro. El informe de
// debug está pensado para copiarse y mandarse, así que se ocultan.
function maskCredentials(value) {
  return (
    String(value || "")
      .replace(/([?&](?:username|password|user|pass)=)[^&]*/gi, "$1***")
      .replace(/\/(live|movie|series|play|stream|timeshift)\/[^/]+\/[^/]+\//gi, "/$1/***/***/")
      // Red de seguridad para paneles con rutas propias: el patrón
      // .../usuario/clave/12345.ts es común y la contraseña iba en claro en los
      // informes de depuración que el usuario copia y comparte.
      .replace(/\/([^/?#]+)\/([^/?#]+)\/(\d+\.(?:ts|m3u8|mp4|mkv))(?=$|[?#])/gi, "/***/***/$3")
  );
}

function maskUrl(url) {
  let s = String(url || "");
  // stream.php?url=... lleva la URL real codificada dentro.
  s = s.replace(/([?&]url=)([^&]+)/i, (all, prefix, value) => {
    let inner = value;
    try {
      inner = decodeURIComponent(value);
    } catch (e) {}
    return prefix + maskCredentials(inner);
  });
  return maskCredentials(s);
}

function logPlayback(kind, detail) {
  playbackLog.push({
    at: channelStartedAt ? (Date.now() - channelStartedAt) / 1000 : 0,
    kind: kind,
    detail: detail == null ? "" : String(detail),
  });
  if (playbackLog.length > MAX_LOG_ENTRIES) playbackLog.shift();
  refreshDebugPanel();
}

function resetPlaybackLog() {
  playbackLog = [];
  channelStartedAt = Date.now();
  refreshDebugPanel();
}

function formatPlaybackLog() {
  if (!playbackLog.length) return "  (sin eventos todavía)";
  // Lo último arriba: al diagnosticar un fallo interesa lo que acaba de pasar.
  return playbackLog
    .slice()
    .reverse()
    .map((e) => "  +" + e.at.toFixed(1) + "s  " + e.kind + (e.detail ? ": " + e.detail : ""))
    .join("\n");
}

function describeMediaError() {
  if (!video || !video.error) return "";
  const names = {
    1: "MEDIA_ERR_ABORTED (cancelado)",
    2: "MEDIA_ERR_NETWORK (fallo de red)",
    3: "MEDIA_ERR_DECODE (no se pudo decodificar)",
    4: "MEDIA_ERR_SRC_NOT_SUPPORTED (formato o URL no soportados)",
  };
  const code = video.error.code;
  const raw = video.error.message || "";
  let text = (names[code] || "código " + code) + (raw ? " · " + raw : "");
  // Chrome describe este caso con un mensaje interno ilegible, pero siempre
  // significa lo mismo: la conexión se cerró antes de mandar un solo fotograma.
  if (/endOfStream before demuxer initialization/i.test(raw)) {
    text += " → traducido: el proveedor cortó la conexión sin enviar vídeo (canal caído o límite de conexiones de la cuenta)";
  }
  return text;
}

/**
 * Pide los primeros bytes del stream para ver qué contesta el servidor. Es lo
 * que distingue un 403, un 404 o el típico límite de conexiones de un fallo
 * del reproductor. Abre una conexión, así que solo se lanza cuando el canal
 * ya ha fallado del todo o cuando se pide a mano.
 */
let probeRunning = false;
let lastProbeAt = 0;

async function probeStream() {
  const url = currentChannelRef ? currentChannelRef.url : "";
  if (!url) {
    logPlayback("diagnostico", "no hay canal que comprobar");
    return;
  }
  // Consultar mientras se ve bien el canal es contraproducente: abre una
  // segunda conexión y, con cuentas de pocas conexiones, el proveedor tira la
  // emisión en curso para dejar sitio a la nueva.
  if (playbackLooksAlive()) {
    showToast("El canal va bien. Diagnosticar abriría otra conexión y puede cortarlo.", 5000);
    return;
  }
  if (playbackRetryTimer) {
    showToast("Espera: se está reconectando el canal");
    return;
  }
  // Cada consulta abre una conexión con el proveedor y el usuario tiene un
  // número limitado. Ni en paralelo ni en ráfaga.
  if (probeRunning) return;
  if (Date.now() - lastProbeAt < 15000) {
    // Avisar por toast y no por registro: insistir con el botón llenaba el
    // log de rechazos y expulsaba justo los eventos que hacía falta leer.
    showToast("Espera unos segundos entre diagnósticos");
    return;
  }

  probeRunning = true;
  lastProbeAt = Date.now();
  const button = document.getElementById("debugProbeBtn");
  if (button) button.disabled = true;

  const base = window.location.origin + window.location.pathname.replace("index.html", "");
  let target;
  try {
    const href = await signedStreamHref(url);
    target = base + href + (href.indexOf("?") >= 0 ? "&" : "?") + "probe=1";
  } catch (e) {
    logPlayback("diagnostico", "no se pudo firmar la consulta");
    probeRunning = false;
    if (button) button.disabled = false;
    return;
  }
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const cut = setTimeout(() => controller && controller.abort(), 15000);

  try {
    const res = await fetch(target, {
      cache: "no-store",
      signal: controller ? controller.signal : undefined,
    });
    const info = await res.json();

    if (info.error) {
      logPlayback("diagnostico", "el relé rechazó la petición: " + info.error);
    } else if (info.curl) {
      logPlayback("diagnostico", "no se pudo conectar con el proveedor · " + info.curl);
    } else if (!info.status) {
      logPlayback("diagnostico", "el proveedor no contestó nada");
    } else if (info.status >= 400) {
      logPlayback("diagnostico", "el proveedor respondió HTTP " + info.status + (info.sample ? " · " + info.sample : ""));
    } else if (!info.bytes) {
      logPlayback("diagnostico", "HTTP " + info.status + " pero sin datos: el proveedor acepta y no emite (canal caído o límite de conexiones)");
    } else if (!info.ts) {
      logPlayback("diagnostico", "HTTP " + info.status + " · " + (info.type || "sin tipo") + " · llegan " + info.bytes + " bytes que no son TS" + (info.sample ? ": " + info.sample : ""));
    } else {
      logPlayback("diagnostico", "HTTP " + info.status + " · TS correcto · " + info.bytes + " bytes: el origen emite bien ahora mismo");
    }
  } catch (e) {
    logPlayback("diagnostico", "sin respuesta: " + (e && e.name === "AbortError" ? "tiempo agotado" : e && e.message));
  } finally {
    clearTimeout(cut);
    if (controller) {
      try {
        controller.abort();
      } catch (e) {}
    }
    probeRunning = false;
    // Sigue bloqueado durante el enfriamiento para que se vea que no sirve
    // de nada insistir.
    setTimeout(() => {
      const b = document.getElementById("debugProbeBtn");
      if (b) b.disabled = false;
    }, 15000);
  }
}

// Segundos ya descargados por delante del punto que se está viendo: es el
// colchón real que queda antes de que la imagen se pare.
function getBufferAhead() {
  if (!video || !video.buffered || !video.buffered.length) return 0;
  try {
    // Se mide contra el final del último tramo en vez de buscar el que
    // contiene al cursor: al pausar justo en el borde del directo, el cursor
    // puede quedar unas milésimas fuera y eso daba cero con buffer de sobra.
    return Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime);
  } catch (e) {
    return 0;
  }
}

let lastDroppedFrames = 0;

// Perder fotogramas en bloque no genera ningún evento del navegador, pero se
// ve como tirones. Anotarlo permite distinguirlo de un corte por falta de
// buffer, que es un problema distinto.
function checkDroppedFrames() {
  if (!video || !video.getVideoPlaybackQuality) return;
  try {
    const dropped = video.getVideoPlaybackQuality().droppedVideoFrames;
    if (dropped < lastDroppedFrames) {
      lastDroppedFrames = dropped;
      return;
    }
    if (dropped - lastDroppedFrames >= 25) {
      logPlayback("fotogramas perdidos", dropped - lastDroppedFrames + " de golpe (total " + dropped + ")");
      lastDroppedFrames = dropped;
    }
  } catch (e) {}
}

function getPlaybackStats() {
  if (!video) return "  (sin reproductor)";

  const lines = [];
  const channel = currentlyPlayingId ? channelById.get(currentlyPlayingId) : null;
  lines.push("  canal: " + (channel ? channel.name : "-"));
  if (channel) {
    lines.push("  categoria: " + (channel.category || "-"));
    lines.push("  tvg-id: " + (channel.tvgId || "-"));
    lines.push("  url origen: " + maskUrl(channel.url));
    lines.push("  url activa: " + maskUrl(video.getAttribute("data-active-url")));
  }
  lines.push("  motor: " + (nativePlaybackActive ? (nativePlayerEngine() === "vlc" ? "LibVLC" : "ExoPlayer") : hls ? "hls.js" : mpegtsPlayer ? "mpegts.js" : "nativo"));
  lines.push("  readyState: " + video.readyState + " · networkState: " + video.networkState);
  const mediaError = describeMediaError();
  if (mediaError) lines.push("  error del <video>: " + mediaError);
  lines.push("  resolucion: " + (video.videoWidth || 0) + "x" + (video.videoHeight || 0));

  lines.push("  buffer por delante: " + getBufferAhead().toFixed(1) + "s");

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

  lines.push("  prebuffer: " + (prebufferResult || "no aplicado"));
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
    "-- eventos del canal (lo mas reciente arriba) --",
    formatPlaybackLog(),
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

function refreshDebugPanel() {
  const output = document.getElementById("debugOutput");
  const overlay = document.getElementById("debugOverlay");
  if (!output || !overlay || !overlay.classList.contains("is-open")) return;
  output.textContent = getDebugReport();
}

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
  }, 2500);
  if (debugZeroCount >= 8) {
    debugZeroCount = 0;
    setDebugOpen(true);
    showToast("Modo debug");
  }
}

/********** RENDERIZAR INTERFAZ **********/
const FAV_KEY = "streambox_favorites";
const HIST_KEY = "streambox_history";
const SORT_KEY = "streambox_sort";
const FAV_NAME = "Favoritos";
const HIST_NAME = "Recientes";
const HIST_MAX = 30;
const STAR_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';

let searchQuery = "";
let renderToken = 0;
let zapBuffer = "";
let zapTimer = null;

function readIdList(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(raw) ? raw.map(String) : [];
  } catch (e) {
    return [];
  }
}

function writeIdList(key, ids) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch (e) {}
}

function getFavorites() {
  return readIdList(FAV_KEY);
}

function isFavorite(id) {
  return getFavorites().indexOf(String(id)) >= 0;
}

function toggleFavorite(channel) {
  if (!channel) return;
  const id = String(channel.id);
  let ids = getFavorites();
  if (ids.indexOf(id) >= 0) ids = ids.filter((x) => x !== id);
  else ids.unshift(id);
  writeIdList(FAV_KEY, ids);
  if (currentCategory === FAV_NAME) {
    const still = getFavorites().some((x) => channelById.has(x));
    renderCategoryButtons(false);
    if (still) selectCategory(FAV_NAME);
    else {
      const names = listCategoryNames();
      if (names[0]) selectCategory(names[0]);
    }
  } else {
    document.querySelectorAll('.fav-btn[data-id="' + CSS.escape(id) + '"]').forEach((btn) => {
      btn.classList.toggle("is-on", isFavorite(id));
    });
    renderCategoryButtons(true);
  }
}

function getHistory() {
  return readIdList(HIST_KEY);
}

function rememberHistory(channel) {
  if (!channel) return;
  const id = String(channel.id);
  const ids = getHistory().filter((x) => x !== id);
  ids.unshift(id);
  writeIdList(HIST_KEY, ids.slice(0, HIST_MAX));
}

function sortMode() {
  return localStorage.getItem(SORT_KEY) === "az" ? "az" : "list";
}

function applySort(channels) {
  if (sortMode() !== "az") return channels.slice();
  return channels.slice().sort((a, b) =>
    displayName(a.name).localeCompare(displayName(b.name), "es", { sensitivity: "base" })
  );
}

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function listCategoryNames() {
  const names = Object.keys(categoriesData).sort();
  const out = [];
  if (isTvLayout() || getFavorites().some((id) => channelById.has(id))) out.push(FAV_NAME);
  if (getHistory().some((id) => channelById.has(id))) out.push(HIST_NAME);
  return out.concat(names);
}

function channelsForCategory(name) {
  if (name === FAV_NAME) return getFavorites().map((id) => channelById.get(id)).filter(Boolean);
  if (name === HIST_NAME) return getHistory().map((id) => channelById.get(id)).filter(Boolean);
  return categoriesData[name] || [];
}

function renderCategoryButtons(keepSelection) {
  if (!categoriesContainer) return;
  categoriesContainer.innerHTML = "";
  const names = listCategoryNames();
  names.forEach((catName) => {
    const btn = document.createElement("button");
    btn.className = "category-btn";
    if (catName === FAV_NAME || catName === HIST_NAME) btn.classList.add("is-special");
    btn.dataset.category = catName;
    btn.textContent = displayCategoryName(catName);
    btn.title = catName;
    btn.tabIndex = isTvLayout() ? -1 : 0;
    btn.addEventListener("click", () => {
      const search = document.getElementById("channelSearch");
      if (search) search.value = "";
      searchQuery = "";
      selectCategory(catName);
      if (isTvLayout()) {
        enterTvChannelsColumn();
        updateCursorVisuals();
      }
    });
    categoriesContainer.appendChild(btn);
  });
  if (keepSelection) {
    document.querySelectorAll(".category-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.category === currentCategory);
    });
  }
}

function renderCategories() {
  renderCategoryButtons(false);
  const names = listCategoryNames();
  if (currentCategory && names.indexOf(currentCategory) >= 0) selectCategory(currentCategory);
  else if (names.length) selectCategory(names[0]);
}

function updateSortButton() {
  const btn = document.getElementById("sortBtn");
  if (!btn) return;
  const az = sortMode() === "az";
  btn.classList.toggle("is-az", az);
  btn.textContent = az ? "A-Z" : "Lista";
  btn.title = az ? "Orden alfabético. Pulsa para el de la lista." : "Orden de la lista. Pulsa para A-Z.";
}

function selectCategory(categoryName, opts) {
  currentCategory = categoryName;
  document.querySelectorAll(".category-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.category === categoryName);
  });

  renderChannels(channelsForCategory(categoryName));
  if (channelColumnTitle) {
    const catLabel = displayCategoryName(categoryName);
    if (activeListId === ALL_LISTS_ID) {
      channelColumnTitle.textContent = catLabel + " · Todas las listas";
    } else {
      const entry = savedLists.find((l) => l.id === activeListId);
      channelColumnTitle.textContent = entry ? catLabel + " · " + entry.name : catLabel;
    }
  }
  if (currentFocus && !(opts && opts.keepFocus)) currentFocus.col = 0;
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
  fallback.textContent = channelInitials(displayName(channel.name));
  // En TV no cargar logos remotos al navegar: satura la red y ralentiza el mando.
  if (!channel.logo || isTvLayout()) return fallback;

  const img = document.createElement("img");
  img.className = "channel-logo";
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = "";
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

function buildChannelRow(channel) {
  const channelDiv = document.createElement("div");
  channelDiv.className = "channel-item";
  channelDiv.dataset.id = channel.id;

  const chno = document.createElement("span");
  chno.className = "channel-chno";
  chno.textContent = channel.chno || "";
  channelDiv.appendChild(chno);

  channelDiv.appendChild(buildChannelThumb(channel));

  const info = document.createElement("div");
  info.className = "channel-info";
  const nameEl = document.createElement("div");
  nameEl.className = "channel-name";
  nameEl.textContent = displayName(channel.name);
  nameEl.title = channel.name;
  info.appendChild(nameEl);

  const epgEl = document.createElement("div");
  epgEl.className = "channel-epg";
  if (searchQuery && channel.category) {
    epgEl.textContent = displayCategoryName(channel.category);
  } else if (hasEPG()) {
    epgEl.textContent = channelEpgLabel(channel);
  }
  epgEl.hidden = !epgEl.textContent;
  if (epgEl.textContent) info.appendChild(epgEl);
  channelDiv.appendChild(info);

  const favBtn = document.createElement("button");
  favBtn.type = "button";
  favBtn.className = "fav-btn" + (isFavorite(channel.id) ? " is-on" : "");
  favBtn.dataset.id = channel.id;
  favBtn.title = "Favorito";
  favBtn.setAttribute("aria-label", "Marcar favorito");
  if (isTvLayout()) favBtn.tabIndex = -1;
  favBtn.innerHTML = STAR_SVG;
  favBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(channel);
  });
  channelDiv.appendChild(favBtn);

  channelDiv.addEventListener("click", () => {
    if (isTvLayout()) {
      if (currentlyPlayingId === channel.id) enterNativeFullscreen();
      else selectChannel(channel);
      return;
    }
    if (currentlyPlayingId === channel.id) {
      if (nativePlayerPlugin()) playChannel(channel);
      else toggleFullscreen();
    } else selectChannel(channel);
  });
  if (currentlyPlayingId === channel.id) channelDiv.classList.add("playing");
  else if (peekLastChannelId() === channel.id) channelDiv.classList.add("last");

  return channelDiv;
}

function channelGridCols() {
  return 1;
}

function channelCardHeight() {
  if (document.body.classList.contains("is-tv")) return 56;
  if (document.body.classList.contains("ui-large")) return 68;
  return 56;
}

function channelGridGap() {
  return document.body.classList.contains("is-tv") ? 4 : 5;
}

function channelGridRowHeight() {
  return channelCardHeight() + channelGridGap();
}

function bindVirtualScroll() {
  if (!channelsContainer || channelsContainer.dataset.virtual === "1") return;
  channelsContainer.dataset.virtual = "1";
  channelsContainer.addEventListener("scroll", () => paintVirtualWindow(), { passive: true });
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => paintVirtualWindow(true));
    ro.observe(channelsContainer);
  }
}

function renderChannels(channels) {
  virtualList =
    currentCategory === FAV_NAME || currentCategory === HIST_NAME ? channels.slice() : applySort(channels);
  virtualRange = { start: -1, end: -1, cols: 0 };
  if (!channelsContainer) return;
  bindVirtualScroll();
  channelsContainer.scrollTop = 0;
  paintVirtualWindow(true);
}

function paintVirtualWindow(force) {
  if (!channelsContainer) return;
  const cols = channelGridCols();
  const rowH = channelGridRowHeight();
  const total = virtualList.length;
  const totalRows = Math.ceil(total / cols) || 0;
  const view = Math.max(channelsContainer.clientHeight || 0, 180);
  const startRow = Math.max(0, Math.floor(channelsContainer.scrollTop / rowH) - 3);
  const endRow = Math.min(totalRows, Math.ceil((channelsContainer.scrollTop + view) / rowH) + 3);
  const start = startRow * cols;
  const end = Math.min(total, endRow * cols);
  if (!force && startRow === virtualRange.start && endRow === virtualRange.end && cols === virtualRange.cols) {
    markTvCursor();
    return;
  }
  virtualRange = { start: startRow, end: endRow, cols: cols };

  const frag = document.createDocumentFragment();
  const head = document.createElement("div");
  head.className = "channels-spacer";
  head.style.height = startRow * rowH + "px";
  frag.appendChild(head);
  if (!total && currentCategory === FAV_NAME) {
    const empty = document.createElement("p");
    empty.className = "tv-fav-empty";
    empty.textContent = "Mantén OK sobre un canal para marcarlo como favorito.";
    frag.appendChild(empty);
  }
  const grid = document.createElement("div");
  grid.className = "channels-grid";
  grid.style.setProperty("--channel-cols", String(cols));
  for (let i = start; i < end; i++) grid.appendChild(buildChannelRow(virtualList[i]));
  frag.appendChild(grid);
  const tail = document.createElement("div");
  tail.className = "channels-spacer";
  tail.style.height = Math.max(0, (totalRows - endRow) * rowH) + "px";
  frag.appendChild(tail);
  channelsContainer.innerHTML = "";
  channelsContainer.appendChild(frag);
  markTvCursor();
}

function runChannelSearch(query) {
  searchQuery = String(query || "").trim();
  if (!searchQuery) {
    const names = listCategoryNames();
    if (currentCategory && names.indexOf(currentCategory) >= 0) selectCategory(currentCategory);
    else if (names[0]) selectCategory(names[0]);
    return;
  }
  const needle = normalizeSearch(searchQuery);
  const hits = channelsData.filter(
    (ch) =>
      normalizeSearch(ch.name).indexOf(needle) >= 0 ||
      normalizeSearch(displayName(ch.name)).indexOf(needle) >= 0 ||
      normalizeSearch(ch.category).indexOf(needle) >= 0 ||
      normalizeSearch(displayCategoryName(ch.category)).indexOf(needle) >= 0 ||
      String(ch.chno) === searchQuery
  );
  document.querySelectorAll(".category-btn").forEach((b) => b.classList.remove("active"));
  renderChannels(hits);
  if (channelColumnTitle) {
    channelColumnTitle.textContent = hits.length === 1 ? "1 resultado" : hits.length + " resultados";
  }
}

function initChannelTools() {
  const search = document.getElementById("channelSearch");
  const sortBtn = document.getElementById("sortBtn");
  updateSortButton();
  if (search) {
    search.addEventListener("input", () => runChannelSearch(search.value));
    search.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        search.value = "";
        runChannelSearch("");
        search.blur();
      }
    });
  }
  if (sortBtn) {
    sortBtn.addEventListener("click", () => {
      localStorage.setItem(SORT_KEY, sortMode() === "az" ? "list" : "az");
      updateSortButton();
      if (searchQuery) runChannelSearch(searchQuery);
      else if (currentCategory) selectCategory(currentCategory);
    });
  }
}

function findChannelByNumber(n) {
  if (!n) return null;
  return channelsData.find((ch) => ch.chno === n) || channelsData[n - 1] || null;
}

function showZap(text) {
  const overlay = document.getElementById("zapOverlay");
  const num = document.getElementById("zapNumber");
  if (num) num.textContent = text;
  if (overlay) overlay.hidden = false;
}

function hideZap() {
  const overlay = document.getElementById("zapOverlay");
  if (overlay) overlay.hidden = true;
}

function commitZap() {
  const n = parseInt(zapBuffer, 10);
  zapBuffer = "";
  hideZap();
  if (!n) return;
  const channel = findChannelByNumber(n);
  if (!channel) {
    showToast("No hay canal " + n);
    return;
  }
  const search = document.getElementById("channelSearch");
  if (search) search.value = "";
  searchQuery = "";
  if (channel.category && categoriesData[channel.category]) selectCategory(channel.category);
  selectChannel(channel);
  const el = channelsContainer
    ? channelsContainer.querySelector('.channel-item[data-id="' + CSS.escape(String(channel.id)) + '"]')
    : null;
  if (el) el.scrollIntoView({ block: "nearest" });
}

function noteZapDigit(digit) {
  zapBuffer += digit;
  if (zapBuffer.length > 4) zapBuffer = zapBuffer.slice(-4);
  showZap(zapBuffer);
  clearTimeout(zapTimer);
  zapTimer = setTimeout(commitZap, 1300);
}

/********** MOTOR DE REPRODUCCIÓN **********/
// Cuando el proveedor cierra la emisión, insistir en seguida solo gasta
// conexiones del límite de la cuenta sin darle tiempo a liberar la anterior.
const PLAYBACK_RETRY_DELAYS = [3000, 8000, 15000];
let currentChannelRef = null;
let playbackRetries = 0;
let playbackRetryTimer = null;
let hlsRecoveries = 0;
let stallCount = 0;
let startLogged = false;

function clearPlaybackRetry() {
  clearTimeout(playbackRetryTimer);
  playbackRetryTimer = null;
}

/**
 * En IPTV los cortes son constantes, así que un fallo no debe dejar la pantalla
 * en negro: se reintenta el mismo canal antes de darse por vencido.
 */
/********** PREBÚFER: acumular antes de mostrar imagen **********/
let prebufferTimer = null;
let prebufferActive = false;
let prebufferResult = "";
let positionLogged = false;

function getPrebufferTarget() {
  return Math.min(getBufferSeconds(), PREBUFFER_MAX_SECONDS);
}

/**
 * Con MSE el tiempo del stream casi nunca empieza en cero: mpegts.js conserva
 * las marcas de tiempo del TS, así que el tramo cargado puede empezar en el
 * segundo 11 mientras el cursor sigue en el 0. El navegador se queda entonces
 * esperando datos para una posición que nunca va a llegar, y la imagen no
 * arranca aunque haya vídeo de sobra descargado.
 *
 * Se llama en cada evento de carga hasta que la reproducción arranca.
 */
function ensureInsideBuffer() {
  if (!video || !video.buffered || !video.buffered.length) return false;
  try {
    const first = video.buffered.start(0);
    const last = video.buffered.end(video.buffered.length - 1);
    if (video.currentTime >= first && video.currentTime <= last) return false;
    if (!positionLogged) {
      positionLogged = true;
      logPlayback("posicion corregida", "el cursor estaba en " + video.currentTime.toFixed(1) + "s y el vídeo empieza en " + first.toFixed(1) + "s");
    }
    video.currentTime = first + 0.05;
    return true;
  } catch (e) {
    return false;
  }
}

function clearPrebuffer() {
  clearTimeout(prebufferTimer);
  prebufferTimer = null;
}

/**
 * Al reanudar tras la pausa, lo acumulado suele quedar en un tramo aparte:
 * el flujo se corta un instante y el navegador crea un segundo rango en vez
 * de alargar el primero. Seguir reproduciendo desde donde estaba obliga a
 * cruzar ese hueco, que es lo que congela la imagen y tira fotogramas.
 */
function jumpOverBufferGap() {
  if (!video || !video.buffered || video.buffered.length < 2) return;
  try {
    const t = video.currentTime;
    for (let i = 0; i < video.buffered.length; i++) {
      const ini = video.buffered.start(i);
      const fin = video.buffered.end(i);
      if (t < ini - 0.1 || t > fin) continue;
      // El hueco solo estorba cuando el cursor ya está pegado al final de su
      // tramo. Saltar antes de tiempo tiraba por la ventana el colchón recién
      // acumulado, porque el tramo nuevo contiene mucho menos que el total.
      if (fin - t > 0.5) return;
      if (i + 1 < video.buffered.length) {
        const siguiente = video.buffered.start(i + 1);
        logPlayback("hueco", "salto de " + (siguiente - t).toFixed(1) + "s al tramo siguiente");
        video.currentTime = siguiente + 0.05;
      }
      return;
    }
  } catch (e) {}
}

function cancelPrebuffer(reason) {
  if (!prebufferActive) return;
  prebufferActive = false;
  clearPrebuffer();
  showVideoSpinner(false);
  if (reason) logPlayback("prebuffer", reason);
}

/**
 * Arranca, pausa enseguida y deja que se acumule. Mientras el vídeo está
 * parado el directo sigue avanzando y lo descargado se apila por delante: ese
 * hueco es exactamente el colchón que después absorbe los cortes.
 *
 * Se hace pausando en vez de retrasando el play() porque los motores solo
 * llenan de verdad una vez la reproducción ha arrancado.
 */
function beginPrebufferFill(channel) {
  clearPrebuffer();
  const target = getPrebufferTarget();
  if (!video || target <= 0) {
    showVideoSpinner(false);
    return;
  }

  // Arrancar en el punto más antiguo de lo descargado suele dejar ya bastante
  // colchón heredado de la ráfaga inicial del proveedor. Cuando ocurre, pausar
  // para nada solo provocaría un tirón al reanudar.
  const heredado = getBufferAhead();
  if (heredado >= target) {
    prebufferResult = heredado.toFixed(1) + "s de " + target + "s (ya venía lleno, sin esperar)";
    logPlayback("prebuffer", prebufferResult);
    showVideoSpinner(false);
    return;
  }

  prebufferActive = true;
  prebufferResult = "llenando...";
  try {
    video.pause();
  } catch (e) {}

  const startedAt = Date.now();
  const initial = heredado;
  let best = initial;
  const deadline = startedAt + Math.min(target * 1000, PREBUFFER_MAX_WAIT_MS);
  const growthCheck = startedAt + 1500;

  const finish = (reason) => {
    prebufferActive = false;
    clearPrebuffer();
    prebufferResult = getBufferAhead().toFixed(1) + "s de " + target + "s (" + reason + ")";
    logPlayback("prebuffer", prebufferResult);
    jumpOverBufferGap();
    showVideoSpinner(false);
    const p = video.play();
    if (p) p.catch(() => {});
  };

  const tick = () => {
    if (!prebufferActive) return;
    if (!currentChannelRef || currentChannelRef.id !== channel.id) {
      prebufferActive = false;
      return;
    }

    const ahead = getBufferAhead();
    if (ahead > best) best = ahead;
    if (ahead >= target) return finish("completo");
    // Hay fuentes que emiten en tiempo estricto y no dejan acumular nada.
    // Detectarlo pronto evita esperar para nada.
    if (Date.now() > growthCheck && best - initial < 0.5) return finish("la fuente no acumula, se sigue sin esperar");
    if (Date.now() > deadline) return finish("tope de espera, se sigue con lo acumulado");

    if (!video.paused) {
      try {
        video.pause();
      } catch (e) {}
    }
    const restante = Math.max(0, deadline - Date.now()) / 1000;
    showVideoSpinner(true, "Colchón " + ahead.toFixed(1) + "s de " + target + "s · " + restante.toFixed(0) + "s", true);
    prebufferTimer = setTimeout(tick, 250);
  };

  tick();
}

function playbackLooksAlive() {
  // readyState >= 3 significa que hay fotogramas listos para seguir pintando.
  return !!video && !video.paused && !video.ended && video.readyState >= 3;
}

function isMpegtsStackOverflow(errorType, errorDetail, errorInfo) {
  const blob = [errorType, errorDetail, errorInfo && errorInfo.msg, errorInfo && errorInfo.code]
    .filter(Boolean)
    .join(" ");
  return /stack size exceeded/i.test(blob);
}

function handlePlaybackFailure(opts) {
  opts = opts || {};
  if (teardownInProgress || !currentChannelRef) return;
  if (playbackRetryTimer) return;
  if (!opts.forceDestroy && playbackLooksAlive()) return;

  // Un demuxer reventado sigue enganchado al <video> y se come el colchón
  // sin pedir datos nuevos. Hay que destruirlo antes de esperar el reintento.
  stopPlayback();
  showVideoSpinner(false);

  if (playbackRetries >= PLAYBACK_RETRY_DELAYS.length) {
    showToast("No se pudo reproducir el canal");
    logPlayback("abandonado", "agotados los " + PLAYBACK_RETRY_DELAYS.length + " reintentos");
    // Ya no hay stream abierto, así que preguntar al servidor no le quita
    // ninguna conexión al usuario y explica el motivo real del fallo.
    probeStream();
    return;
  }

  const delay = PLAYBACK_RETRY_DELAYS[playbackRetries];
  playbackRetries++;
  showToast("Reconectando (" + playbackRetries + "/" + PLAYBACK_RETRY_DELAYS.length + ")...");
  logPlayback("reintento", playbackRetries + "/" + PLAYBACK_RETRY_DELAYS.length + " en " + delay / 1000 + "s");

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
  // Cada canal empieza con el registro limpio: mezclarlo con el anterior solo
  // estorba al buscar por qué ha fallado este.
  resetPlaybackLog();
  startLogged = false;
  prebufferResult = "";
  positionLogged = false;
  lastDroppedFrames = 0;
  logPlayback("canal", channel.name + " · " + (channel.category || "sin categoría"));
  clearPlaybackRetry();
  rememberLastChannel(channel);
  startPlayback(channel);
  updatePlaybackStatus();
}

function nativePlayerEngine() {
  try {
    const pref = getPreferredNativeEngine();
    if (pref) return pref;
    const n = window.StreamBoxNative;
    if (n && n.engine) return String(n.engine);
    if (isTvLayout()) return "vlc";
  } catch (e) {}
  return "exo";
}

function getPreferredNativeEngine() {
  try {
    const v = localStorage.getItem(ENGINE_KEY);
    if (v === "exo" || v === "vlc") return v;
  } catch (e) {}
  return "";
}

function setPreferredNativeEngine(engine, opts) {
  const e = engine === "exo" ? "exo" : "vlc";
  try {
    localStorage.setItem(ENGINE_KEY, e);
  } catch (err) {}
  try {
    window.StreamBoxNative = Object.assign({}, window.StreamBoxNative || {}, { engine: e });
  } catch (err) {}
  syncEngineSelects(e);
  if (!(opts && opts.silent)) {
    showToast(e === "vlc" ? "Reproductor: LibVLC" : "Reproductor: ExoPlayer");
  }
  return e;
}

function syncEngineSelects(engine) {
  const e = engine || nativePlayerEngine();
  ["engineSelect", "loginEngineSelect"].forEach((id) => {
    const sel = document.getElementById(id);
    if (sel) sel.value = e === "exo" ? "exo" : "vlc";
  });
}

function initNativeEnginePicker() {
  const native = isNativeApp() || nativeTvFlag() === true || document.documentElement.classList.contains("is-native-tv");
  const loginWrap = document.getElementById("loginEngineControl");
  const headerWrap = document.getElementById("engineControl");
  if (loginWrap) loginWrap.hidden = !native;
  if (headerWrap) headerWrap.hidden = !native;
  if (!native) return;

  if (!getPreferredNativeEngine()) {
    setPreferredNativeEngine(isTvLayout() || nativeTvFlag() === true ? "vlc" : "exo", { silent: true });
  } else {
    syncEngineSelects(getPreferredNativeEngine());
  }

  const onChange = (ev) => {
    const val = ev && ev.target ? ev.target.value : "vlc";
    setPreferredNativeEngine(val);
  };
  const loginSel = document.getElementById("loginEngineSelect");
  const headerSel = document.getElementById("engineSelect");
  if (loginSel && !loginSel.dataset.bound) {
    loginSel.dataset.bound = "1";
    loginSel.addEventListener("change", onChange);
  }
  if (headerSel && !headerSel.dataset.bound) {
    headerSel.dataset.bound = "1";
    headerSel.addEventListener("change", onChange);
  }
}

function nativePlayerPlugin() {
  try {
    const cap = window.Capacitor;
    if (!cap) return null;
    const native = typeof cap.isNativePlatform === "function" ? cap.isNativePlatform() : !!cap.isNative;
    if (!native) return null;
    const plugin = cap.Plugins && cap.Plugins.NativePlayer;
    return plugin && typeof plugin.play === "function" ? plugin : null;
  } catch (e) {
    return null;
  }
}

function nativePlayerStop() {
  nativePlaybackActive = false;
  nativeFullscreen = false;
  const plugin = nativePlayerPlugin();
  if (!plugin || typeof plugin.stop !== "function") return;
  try {
    plugin.stop();
  } catch (e) {}
}

function nativeEmbedRect() {
  const wrap = document.querySelector(".video-wrapper");
  const r = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0, width: 320, height: 180 };
  return {
    left: r.left,
    top: r.top,
    width: Math.max(120, r.width),
    height: Math.max(68, r.height),
    vw: window.innerWidth,
    vh: window.innerHeight,
  };
}

function bindNativePlayerEvents() {
  const plugin = nativePlayerPlugin();
  if (!plugin || plugin.__streamboxBound) return;
  plugin.__streamboxBound = true;
  if (typeof plugin.addListener !== "function") return;
  plugin.addListener("nativePlayer", (ev) => {
    if (!ev) return;
    if (typeof ev.fullscreen === "boolean") nativeFullscreen = ev.fullscreen;
    if (ev.engine) {
      try {
        window.StreamBoxNative = Object.assign({}, window.StreamBoxNative || {}, { engine: ev.engine });
      } catch (e) {}
    }
    if (ev.stopped) {
      nativePlaybackActive = false;
      nativeFullscreen = false;
    }
  });
}

function layoutNativePlayer() {
  if (!nativePlaybackActive || nativeFullscreen) return;
  const plugin = nativePlayerPlugin();
  if (!plugin || typeof plugin.layout !== "function") return;
  plugin.layout(nativeEmbedRect()).catch(() => {});
}

function enterNativeFullscreen() {
  if (nativePlayerPlugin() && (nativePlaybackActive || currentlyPlayingId)) {
    const plugin = nativePlayerPlugin();
    nativeFullscreen = true;
    if (typeof plugin.setFullscreen === "function") {
      plugin.setFullscreen(Object.assign({ fullscreen: true, engine: nativePlayerEngine() }, nativeEmbedRect())).catch(() => {});
      return;
    }
    if (currentChannelRef) startNativePlayback(currentChannelRef, { fullscreen: true });
    return;
  }
  enterFullscreen();
}

function exitNativeFullscreen() {
  if (nativePlayerPlugin() && nativePlaybackActive && nativeFullscreen) {
    const plugin = nativePlayerPlugin();
    nativeFullscreen = false;
    if (typeof plugin.setFullscreen === "function") {
      plugin.setFullscreen(Object.assign({ fullscreen: false }, nativeEmbedRect())).catch(() => {});
      return true;
    }
  }
  if (isFullscreen()) {
    exitFullscreen();
    return true;
  }
  return false;
}

async function startNativePlayback(channel, opts) {
  const plugin = nativePlayerPlugin();
  if (!plugin) return false;
  bindNativePlayerEvents();
  const gen = ++playGen;
  showVideoSpinner(true, "Abriendo reproductor…");
  stopPlayback({ keepNative: true });
  updateActivity(channel);
  resetTrackSelectors();
  hlsRecoveries = 0;

  const originalUrl = channel.url;
  const isM3u8 = /\.m3u8(\?|$)/i.test(originalUrl) || originalUrl.toLowerCase().includes(".m3u8");
  const currentDomain = window.location.origin + window.location.pathname.replace("index.html", "");

  let playUrl = originalUrl;
  let mime = "application/x-mpegURL";
  if (!isM3u8) {
    playUrl = currentDomain + (await signedStreamHref(originalUrl));
    mime = "video/mp2t";
  }
  if (gen !== playGen) return true;

  const fullscreen = !isTvLayout() || !!(opts && opts.fullscreen);
  nativeFullscreen = fullscreen;
  try {
    const ret = await plugin.play(
      Object.assign(
        {
          url: playUrl,
          title: displayName(channel.name),
          mime: mime,
          fullscreen: fullscreen,
          engine: nativePlayerEngine(),
        },
        nativeEmbedRect()
      )
    );
    nativePlaybackActive = true;
    showVideoSpinner(false);
    const engine = (ret && ret.engine) || nativePlayerEngine();
    const label = engine === "vlc" ? "LibVLC" : "ExoPlayer";
    logPlayback("motor", label + " · " + (fullscreen ? "pantalla completa" : "ventana") + " · " + maskUrl(playUrl));
    requestAnimationFrame(() => layoutNativePlayer());
  } catch (e) {
    nativePlaybackActive = false;
    nativeFullscreen = false;
    showVideoSpinner(false);
    logPlayback("error nativo", String((e && e.message) || e));
    showToast("No se pudo abrir el reproductor nativo");
  }
  return true;
}

function startPlayback(channel) {
  if (nativePlayerPlugin()) {
    startNativePlayback(channel);
    return;
  }
  if (!video) return;
  const gen = ++playGen;
  showVideoSpinner(true);
  stopPlayback();
  updateActivity(channel);
  resetTrackSelectors();
  hlsRecoveries = 0;

  const currentDomain = window.location.origin + window.location.pathname.replace("index.html", "");
  const originalUrl = channel.url;
  const isTs = /\.ts(\?|$)/i.test(originalUrl) || originalUrl.toLowerCase().includes(".ts");
  const isM3u8 = /\.m3u8(\?|$)/i.test(originalUrl) || originalUrl.toLowerCase().includes(".m3u8");
  const bufferSec = getEngineBufferSeconds();

  let prebufferEnabled = false;

  const tryAutoPlay = () => {
    if (gen !== playGen) return;
    ensureInsideBuffer();
    const onStarted = () => {
      if (prebufferEnabled) beginPrebufferFill(channel);
      else showVideoSpinner(false);
    };

    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.then(onStarted).catch((err) => {
        showVideoSpinner(false);
        if (err && err.name === "NotAllowedError") showToast("Pulsa ▶ para empezar");
      });
    } else {
      onStarted();
    }
  };

  const begin = async () => {
    if (gen !== playGen) return;
    const mseSupported = window.mpegts && mpegts.getFeatureList().mseLivePlayback;

    if (isTs && mseSupported) {
      const proxiedTsUrl = currentDomain + (await signedStreamHref(originalUrl));
      if (gen !== playGen) return;
      video.setAttribute("data-active-url", proxiedTsUrl);
      mpegtsPlayer = mpegts.createPlayer(
        { type: "mse", isLive: true, url: proxiedTsUrl },
        {
          enableWorker: true,
          enableStashBuffer: true,
          stashInitialSize: 384 * 1024,
          liveBufferLatencyChasing: false,
        }
      );
      prebufferEnabled = true;
      mpegtsPlayer.attachMediaElement(video);
      mpegtsPlayer.load();
      tryAutoPlay();
      mpegtsPlayer.on(mpegts.Events.ERROR, (errorType, errorDetail, errorInfo) => {
        const info = errorInfo && (errorInfo.msg || errorInfo.code) ? " · " + (errorInfo.code || "") + " " + (errorInfo.msg || "") : "";
        logPlayback("error mpegts", errorType + " / " + errorDetail + info);
        const stack = isMpegtsStackOverflow(errorType, errorDetail, errorInfo);
        if (stack) logPlayback("demuxer", "mpegts se desbordó; se destruye el motor antes de reintentar");
        handlePlaybackFailure({ forceDestroy: stack });
      });
      logPlayback("motor", "mpegts.js · buffer " + bufferSec + "s · " + maskUrl(proxiedTsUrl));
      return;
    }

    if (gen !== playGen) return;
    startPlaybackLegacy(channel, originalUrl, isTs, isM3u8, mseSupported, bufferSec, tryAutoPlay, () => {
      prebufferEnabled = true;
    });
  };

  begin();
}

function startPlaybackLegacy(channel, originalUrl, isTs, isM3u8, mseSupported, bufferSec, tryAutoPlay, enablePrebuffer) {
  if (isTs && !mseSupported) {
    const iosUrl = originalUrl.replace(/\.ts(\?|$)/i, ".m3u8$1");
    video.setAttribute("data-active-url", iosUrl);
    video.src = iosUrl;
    video.addEventListener("loadedmetadata", tryAutoPlay, { once: true });
    logPlayback("motor", "nativo (sin MSE, .ts convertido a .m3u8) · sin prebúfer · " + maskUrl(iosUrl));
    return;
  }
  if (isM3u8) {
    video.setAttribute("data-active-url", originalUrl);
    if (window.Hls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: bufferSec + 5,
        maxMaxBufferLength: bufferSec * 2 + 10,
        liveSyncDurationCount: 3,
        backBufferLength: 0,
      });
      hls.loadSource(originalUrl);
      hls.attachMedia(video);
      logPlayback("motor", "hls.js · buffer " + bufferSec + "s · " + maskUrl(originalUrl));
      enablePrebuffer();
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        refreshTrackSelectors();
        logPlayback("manifiesto", (hls.levels || []).length + " calidades disponibles");
        tryAutoPlay();
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, refreshTrackSelectors);
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, refreshTrackSelectors);
      hls.on(Hls.Events.ERROR, (e, data) => {
        if (!data) return;
        const parts = [data.type, data.details];
        if (data.response && data.response.code) parts.push("HTTP " + data.response.code);
        if (data.reason) parts.push(data.reason);
        if (data.url) parts.push(maskUrl(data.url));
        logPlayback(data.fatal ? "error hls (grave)" : "aviso hls", parts.filter(Boolean).join(" · "));
        if (!data.fatal) return;
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
      logPlayback("motor", "nativo (hls.js no soportado) · " + maskUrl(originalUrl));
    }
    return;
  }
  video.setAttribute("data-active-url", originalUrl);
  video.src = originalUrl;
  tryAutoPlay();
  logPlayback("motor", "nativo (formato no reconocido) · " + maskUrl(originalUrl));
}

/********** ESTADO DEL <video> **********/
if (video) {
  video.preload = "auto";

  video.addEventListener("playing", () => {
    if (playbackRetries > 0) logPlayback("recuperado", "tras " + playbackRetries + " reintento(s)");
    else if (!startLogged) logPlayback("reproduciendo", video.videoWidth + "×" + video.videoHeight);
    startLogged = true;
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
    // Este es el momento en que un hueco entre tramos sí molesta: la
    // reproducción se ha quedado clavada al borde y no puede cruzarlo sola.
    jumpOverBufferGap();
    if (bufferingSpinnerTimer) return;
    bufferingSpinnerTimer = setTimeout(() => {
      showVideoSpinner(true);
      // Solo se registran los cortes reales; los de medio segundo son
      // constantes en directo y taparían el resto del registro.
      logPlayback("corte", "nº " + stallCount + " · buffer " + getBufferAhead().toFixed(1) + "s");
    }, 900);
  });
  video.addEventListener("canplay", () => {
    clearTimeout(bufferingSpinnerTimer);
    bufferingSpinnerTimer = null;
  });

  // Desglose del arranque: separa lo que tarda la conexión de lo que tarda el
  // decodificador en encontrar un fotograma clave.
  video.addEventListener("loadedmetadata", () => {
    logPlayback("metadatos", "cabecera del stream leída");
    ensureInsideBuffer();
  });
  video.addEventListener("loadeddata", () => {
    logPlayback("primer dato", "listo para decodificar");
    ensureInsideBuffer();
  });
  video.addEventListener("canplay", ensureInsideBuffer);

  // Hasta que arranca de verdad se vigila en cada llegada de datos: el desfase
  // solo se puede corregir cuando ya hay algo en el buffer.
  video.addEventListener("progress", () => {
    if (!startLogged) ensureInsideBuffer();
  });
  // mpegts.js sigue descargando por su cuenta con el vídeo en pausa, pero
  // hls.js se detiene al llegar a maxBufferLength. Durante la pausa interesa
  // dejarlo crecer: es lo que da colchón al reanudar.
  video.addEventListener("pause", () => {
    if (!hls) return;
    try {
      hls.config.maxBufferLength = 300;
    } catch (e) {}
  });
  video.addEventListener("play", () => {
    // Si es el usuario quien le da al play durante el llenado, manda él.
    cancelPrebuffer("cancelado por el usuario");
    if (!hls) return;
    try {
      hls.config.maxBufferLength = getEngineBufferSeconds();
    } catch (e) {}
  });

  video.addEventListener("error", () => {
    if (!teardownInProgress) logPlayback("error del <video>", describeMediaError() || "sin detalle");
    handlePlaybackFailure();
  });
  video.addEventListener("ended", () => {
    if (!teardownInProgress) logPlayback("fin del stream", "el servidor cerró la emisión");
    handlePlaybackFailure();
  });
}

/********** ESTADO DE REPRODUCCIÓN SIEMPRE VISIBLE **********/
const statusDot = document.getElementById("statusDot");
const statusBufferText = document.getElementById("statusBufferText");
const statusBarFill = document.getElementById("statusBarFill");
const statusQuality = document.getElementById("statusQuality");
const statusStalls = document.getElementById("statusStalls");

const goLiveBtn = document.getElementById("goLiveBtn");
const stopBtn = document.getElementById("stopBtn");
let channelLiveStats = { id: null, resolution: "", bitrate: "" };

// Sin perseguidor de latencia el retraso podría crecer sin fin tras muchos
// baches, así que hay un tope; por debajo de él el colchón es bienvenido.
const MAX_LIVE_DELAY = 90;
const LIVE_EDGE_MARGIN = 1.5;
// En pausa el origen sigue mandando y el colchón puede crecer sin fin: eso
// gasta la conexión de la cuenta y, al reanudar, deja un retraso enorme.
const MAX_PAUSED_BUFFER_SECONDS = 15 * 60;

function setStatusLevel(level) {
  if (statusDot) statusDot.className = "status-dot " + level;
  if (statusBarFill) statusBarFill.className = level === "is-good" ? "" : level;
}

function goLive() {
  if (!video) return;
  try {
    if (!video.buffered.length) return;
    const end = video.buffered.end(video.buffered.length - 1);
    video.currentTime = Math.max(0, end - LIVE_EDGE_MARGIN);
    if (video.paused) video.play().catch(() => {});
  } catch (e) {}
}

function enforceLiveDelay() {
  if (!video) return;
  const ahead = getBufferAhead();
  if (video.paused) {
    if (ahead > MAX_PAUSED_BUFFER_SECONDS) {
      stopChannel("Colchón de 15 min: se ha parado para no seguir descargando");
    }
    return;
  }
  if (ahead > MAX_LIVE_DELAY) goLive();
}

function stopChannel(reason) {
  if (!currentlyPlayingId && !currentChannelRef) return;
  clearPlaybackRetry();
  currentChannelRef = null;
  currentlyPlayingId = null;
  stopPlayback();
  showVideoSpinner(false);
  sendActivity("stop");
  activeConnection = null;
  document.querySelectorAll(".channel-item").forEach((item) => {
    item.classList.remove("playing");
    if (peekLastChannelId() === item.dataset.id) item.classList.add("last");
  });
  if (epgNowEl) epgNowEl.textContent = "--:--";
  if (epgNextEl) epgNextEl.textContent = "--:--";
  renderEpgTimeline();
  updatePlaybackStatus();
  logPlayback("parado", reason || "detenido por el usuario, conexión liberada");
  showToast(reason || "Canal detenido");
}

if (goLiveBtn) goLiveBtn.addEventListener("click", goLive);
if (stopBtn) stopBtn.addEventListener("click", stopChannel);

function updatePlaybackStatus() {
  if (!statusBufferText) return;

  if (!currentlyPlayingId) {
    statusBufferText.textContent = "Buffer --";
    if (statusBarFill) statusBarFill.style.width = "0%";
    if (statusQuality) statusQuality.textContent = "Sin canal";
    if (statusStalls) statusStalls.textContent = "";
    if (goLiveBtn) goLiveBtn.hidden = true;
    if (stopBtn) stopBtn.hidden = true;
    setStatusLevel("");
    channelLiveStats = { id: null, resolution: "", bitrate: "" };
    refreshVisibleChannelStats();
    return;
  }

  if (stopBtn) stopBtn.hidden = false;

  const target = getBufferSeconds();
  const ahead = getBufferAhead();
  const ratio = target > 0 ? Math.min(1, ahead / target) : 0;

  statusBufferText.textContent = "Buffer " + ahead.toFixed(1) + " / " + target + " s";
  if (statusBarFill) statusBarFill.style.width = Math.round(ratio * 100) + "%";
  // Por debajo de dos segundos de colchón cualquier bache corta la imagen.
  setStatusLevel(ahead < 2 ? "is-empty" : ratio < 0.35 ? "is-low" : "is-good");

  // Lo acumulado por delante es exactamente lo que se va por detrás del
  // directo, así que sirve de las dos cosas: colchón y retraso.
  if (goLiveBtn) {
    const behind = ahead >= 8;
    goLiveBtn.hidden = !behind;
    if (behind) goLiveBtn.textContent = "Ir al directo (−" + Math.round(ahead) + "s)";
  }

  enforceLiveDelay();
  checkDroppedFrames();

  if (statusQuality) {
    if (nativePlaybackActive) {
      const label = nativePlayerEngine() === "vlc" ? "LibVLC" : "ExoPlayer";
      statusQuality.textContent = label;
      channelLiveStats = { id: currentlyPlayingId, resolution: "", bitrate: label };
    } else {
      const parts = [];
      let resolution = "";
      let bitrate = "";
      if (video && video.videoWidth) {
        resolution = video.videoWidth + "×" + video.videoHeight;
        parts.push(resolution);
      }
      try {
        const level = hls && hls.levels ? hls.levels[hls.currentLevel] : null;
        if (level && level.bitrate) {
          bitrate = Math.round(level.bitrate / 1000) + " kbps";
          parts.push(bitrate);
        }
      } catch (e) {}
      statusQuality.textContent = parts.length ? parts.join(" · ") : "Conectando...";
      channelLiveStats = { id: currentlyPlayingId, resolution: resolution, bitrate: bitrate };
    }
    refreshVisibleChannelStats();
  }

  if (statusStalls) {
    statusStalls.textContent = stallCount === 1 ? "1 corte" : stallCount + " cortes";
  }
}

setInterval(updatePlaybackStatus, 1000);
updatePlaybackStatus();

/********** ÚLTIMO CANAL **********/
const LAST_CHANNEL_KEY = "streambox_last_channel";

function rememberLastChannel(channel) {
  try {
    localStorage.setItem(LAST_CHANNEL_KEY, JSON.stringify({ id: channel.id, cat: channel.category }));
  } catch (e) {}
}

function peekLastChannelId() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_CHANNEL_KEY) || "null");
    return saved && saved.id ? String(saved.id) : "";
  } catch (e) {
    return "";
  }
}

function selectChannel(channel) {
  if (!channel) return;
  currentlyPlayingId = channel.id;
  rememberHistory(channel);
  renderCategoryButtons(true);
  document.querySelectorAll(".channel-item").forEach((item) => {
    item.classList.toggle("playing", item.dataset.id === channel.id);
    item.classList.remove("last");
  });
  playChannel(channel);
  refreshPlayerEPG();
  renderEpgTimeline();
  if (isTvLayout()) requestAnimationFrame(() => layoutNativePlayer());
}

function restoreLastChannel() {
  // Solo deja vista la categoría y el canal de la última sesión. Arrancar el
  // stream aquí gastaba una conexión del proveedor (y minutos de espera) en
  // un canal que a menudo ni siquiera se llega a ver.
  try {
    const raw = localStorage.getItem(LAST_CHANNEL_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    const channel = saved && saved.id ? channelById.get(saved.id) : null;
    if (!channel) return false;

    const category = saved.cat && categoriesData[saved.cat] ? saved.cat : channel.category;
    if (category && categoriesData[category]) selectCategory(category);

    const el = channelsContainer
      ? channelsContainer.querySelector('.channel-item[data-id="' + CSS.escape(String(channel.id)) + '"]')
      : null;
    if (el) {
      el.classList.add("last");
      el.scrollIntoView({ block: "nearest" });
    }
    const items = Array.from(document.querySelectorAll(".channel-item"));
    const idx = items.indexOf(el);
    if (idx >= 0) {
      currentFocus.col = 1;
      currentFocus.row = idx;
      if (isTvLayout()) ensureTvChannelVisible();
      updateCursorVisuals();
    }
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

const displayBtn = document.getElementById("displayBtn");
if (displayBtn) displayBtn.addEventListener("click", cycleUiMode);

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
if (airplayBtn && video) {
  const canAirPlay =
    typeof video.webkitShowPlaybackTargetPicker === "function" || !!window.WebKitPlaybackTargetAvailabilityEvent;
  if (document.body.classList.contains("is-ios") && canAirPlay) airplayBtn.hidden = false;
  if (window.WebKitPlaybackTargetAvailabilityEvent) {
    video.addEventListener("webkitplaybacktargetavailabilitychanged", (e) => {
      if (document.body.classList.contains("is-ios")) {
        airplayBtn.hidden = false;
        return;
      }
      airplayBtn.hidden = e.availability !== "available";
    });
  }
  airplayBtn.addEventListener("click", () => {
    try {
      if (typeof video.webkitShowPlaybackTargetPicker === "function") video.webkitShowPlaybackTargetPicker();
      else showToast("AirPlay no está disponible en este navegador");
    } catch (err) {
      showToast("AirPlay no está disponible en este navegador");
    }
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

if (castButton && document.body.classList.contains("is-ios")) {
  castButton.hidden = false;
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
    showToast(
      document.body.classList.contains("is-ios")
        ? "Chromecast no está disponible en Safari de iPhone; usa AirPlay o Chrome"
        : "Chromecast no disponible en este navegador"
    );
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
let epgOpenStartTs = 0;

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
  if (title) title.textContent = channel ? "Guía · " + displayName(channel.name) : "Guía del canal";
  if (title && channel) title.title = channel.name;

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
    slot.dataset.start = String(p.startTs);

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

    const isNow = p.startTs <= now && now < p.stopTs;
    if (isNow) {
      slot.classList.add("is-now");
      slot.style.width = Math.min(380, Math.max(168, minutes * 3.6)) + "px";
      const progress = document.createElement("div");
      progress.className = "epg-slot-progress";
      progress.style.width = Math.round(((now - p.startTs) / (p.stopTs - p.startTs)) * 100) + "%";
      slot.appendChild(progress);
      nowSlot = slot;
    } else if (epgOpenStartTs && p.startTs === epgOpenStartTs) {
      slot.classList.add("is-open");
      slot.style.width = Math.min(380, Math.max(180, minutes * 3.4)) + "px";
    }

    slot.addEventListener("click", () => {
      if (slot.classList.contains("is-now")) {
        box.querySelectorAll(".epg-slot.is-open").forEach((el) => el.classList.remove("is-open"));
        epgOpenStartTs = 0;
        return;
      }
      const wasOpen = slot.classList.contains("is-open");
      box.querySelectorAll(".epg-slot.is-open").forEach((el) => el.classList.remove("is-open"));
      if (wasOpen) {
        epgOpenStartTs = 0;
      } else {
        slot.classList.add("is-open");
        epgOpenStartTs = p.startTs;
        slot.style.width = Math.min(380, Math.max(180, minutes * 3.4)) + "px";
      }
    });

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
  logoutRequested = true;
  liveSession = false;
  remoteLoginBusy = false;
  loginCancelled = false;
  try {
    sessionStorage.setItem(LOGOUT_AT_KEY, String(Date.now()));
  } catch (e) {}
  sendActivity("stop");
  stopActivityMonitoring();
  stopRemotePolling();
  clearInterval(epgRefreshTimer);
  clearInterval(epgReloadTimer);
  clearTimeout(epgRetryTimer);
  clearPlaybackRetry();
  currentChannelRef = null;
  currentlyPlayingId = null;
  localStorage.removeItem("xtream_user");
  document.documentElement.classList.remove("has-session");
  stopPlayback();
  showVideoSpinner(false);
  currentUser = null;
  sessionToken = null;
  activeConnection = null;
  channelsData = [];
  categoriesData = {};
  channelById = new Map();
  setLoginStatus(
    peekLastList()
      ? "Sesión cerrada. Pulsa Recargar para volver a entrar, o escanea el QR si quieres otra lista."
      : "Sesión cerrada. Escanea el QR para cargar la lista."
  );
  showScreen("login");
  startRemotePolling();
}

async function forceReloadApp() {
  setLoginStatus("Recargando…");
  showSpinner(true, "Recargando…");
  try {
    sessionStorage.removeItem(LOGOUT_AT_KEY);
  } catch (e) {}
  try {
    const last = localStorage.getItem(LAST_LIST_KEY);
    if (last) localStorage.setItem(SESSION_KEY, last);
  } catch (e) {}
  try {
    if (navigator.serviceWorker) {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage("limpiar-cache");
      }
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) {}
  try {
    if (window.caches && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {}
  const url = new URL(window.location.href);
  url.searchParams.set("r", String(Date.now()));
  url.searchParams.set("v", "20260824d");
  window.location.replace(url.toString());
}

async function doRefresh() {
  if (!currentUser) return;
  if (currentUser.isMerged || activeListId === ALL_LISTS_ID) {
    showToast("Elige una lista concreta para actualizarla");
    return;
  }
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

const forceReloadBtn = document.getElementById("forceReloadBtn");
if (forceReloadBtn) forceReloadBtn.addEventListener("click", forceReloadApp);

getTvHeaderActions().forEach((btn, i) => {
  btn.addEventListener("focus", () => {
    if (!isTvLayout() || isLoginScreenActive()) return;
    if (currentFocus.col === TV_HEADER_COL && currentFocus.row === i) return;
    currentFocus.col = TV_HEADER_COL;
    currentFocus.row = i;
    updateCursorVisuals();
  });
});

const spinnerSkip = document.getElementById("spinnerSkip");
if (spinnerSkip) {
  spinnerSkip.addEventListener("click", (ev) => {
    // El clic no debe llegar al vídeo, que lo interpretaría como pausa.
    ev.stopPropagation();
    cancelPrebuffer("espera saltada a mano");
    jumpOverBufferGap();
    const p = video && video.play();
    if (p) p.catch(() => {});
  });
}

const bufferSelect = document.getElementById("bufferSelect");
if (bufferSelect) {
  bufferSelect.value = String(getBufferSeconds());
  // Un valor guardado de una versión anterior puede no estar en la lista.
  if (!bufferSelect.value) bufferSelect.value = String(setBufferSeconds(DEFAULT_BUFFER_SECONDS));
  bufferSelect.addEventListener("change", () => {
    const n = setBufferSeconds(bufferSelect.value);
    showToast(n > 0 ? "Colchón de " + n + "s antes de ver imagen" : "Arranque rápido, sin esperar colchón");
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
const BACK_KEYS = ["Escape", "Backspace", "BrowserBack", "GoBack"];
// El botón Atrás de los mandos de Tizen y webOS llega con estos códigos.
const BACK_KEYCODES = [10009, 461];
const OK_KEYCODES = [13, 23];

function isTypingTarget(target) {
  return !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
}

function isConfirmKey(e) {
  return (
    e.key === "Enter" ||
    e.key === "OK" ||
    e.key === "Select" ||
    e.key === "NumpadEnter" ||
    OK_KEYCODES.includes(e.keyCode)
  );
}

function isLoginScreenActive() {
  const loginScreen = document.getElementById("loginScreen");
  return !!(loginScreen && loginScreen.style.display !== "none" && loginScreen.classList.contains("active"));
}

function initTvLoginFocus() {
  const reload = document.getElementById("forceReloadBtn");
  if (!reload) return;
  reload.classList.add("login-focus");
  if (isTvLayout()) {
    try {
      reload.focus({ preventScroll: true });
    } catch (e) {
      reload.focus();
    }
  }
}

// Al salir de pantalla completa el cursor vuelve a la lista, sobre el canal
// que se está viendo, para poder seguir zapeando con el mando.
function focusChannelList() {
  currentFocus.col = 1;
  const playing = virtualList.findIndex((ch) => ch && String(ch.id) === String(currentlyPlayingId));
  const lastId = peekLastChannelId();
  const last = virtualList.findIndex((ch) => ch && String(ch.id) === String(lastId));
  if (playing >= 0) currentFocus.row = playing;
  else if (last >= 0) currentFocus.row = last;
  else currentFocus.row = Math.min(currentFocus.row || 0, Math.max(0, virtualList.length - 1));
  ensureTvChannelVisible();
  updateCursorVisuals();
}

function markTvCursor() {
  document.querySelectorAll(".category-btn, .channel-item").forEach((el) => el.classList.remove("cursor"));
  if (currentFocus.col === 0) {
    const cat = document.querySelectorAll(".category-btn")[currentFocus.row];
    if (cat) cat.classList.add("cursor");
    return;
  }
  if (currentFocus.col !== 1) return;
  const ch = virtualList[currentFocus.row];
  if (!ch || !channelsContainer) return;
  const el = channelsContainer.querySelector('.channel-item[data-id="' + CSS.escape(String(ch.id)) + '"]');
  if (el) el.classList.add("cursor");
}

function tvFocusedChannel() {
  return currentFocus.col === 1 ? virtualList[currentFocus.row] || null : null;
}

function toggleTvFavorite() {
  const ch = tvFocusedChannel();
  if (!ch) return false;
  toggleFavorite(ch);
  showToast(isFavorite(ch.id) ? "Añadido a Favoritos" : "Quitado de Favoritos");
  markTvCursor();
  return true;
}

function activateTvChannel() {
  const ch = tvFocusedChannel();
  if (!ch) return;
  if (currentlyPlayingId === ch.id) enterNativeFullscreen();
  else selectChannel(ch);
}

let tvOkHoldTimer = null;
let tvOkHoldFired = false;

function clearTvOkHold() {
  clearTimeout(tvOkHoldTimer);
  tvOkHoldTimer = null;
}

function isYellowKey(e) {
  return (
    e.key === "Yellow" ||
    e.key === "F2" ||
    e.key === "ColorF2Yellow" ||
    e.keyCode === 185 ||
    e.keyCode === 405
  );
}

document.addEventListener("keydown", (e) => {
  if (isSplashActive()) {
    const skipSplash =
      e.key === "Enter" ||
      e.key === " " ||
      e.key === "Escape" ||
      e.key === "OK" ||
      e.key === "Select" ||
      BACK_KEYS.includes(e.key) ||
      BACK_KEYCODES.includes(e.keyCode);
    if (skipSplash) {
      e.preventDefault();
      dismissSplash();
    }
    return;
  }

  const digit = e.key >= "0" && e.key <= "9" ? e.key : "";
  const onPlayer = document.getElementById("mainScreen") && document.getElementById("mainScreen").classList.contains("active");
  if (digit && onPlayer && !isTypingTarget(e.target) && !isSplashActive()) {
    e.preventDefault();
    if (digit === "0") noteDebugZero();
    noteZapDigit(digit);
    return;
  }

  if (BACK_KEYS.includes(e.key) || BACK_KEYCODES.includes(e.keyCode)) {
    if (e.key === "Backspace" && isTypingTarget(e.target)) return;
    if (isLoginScreenActive()) return;
    e.preventDefault();
    if (exitNativeFullscreen()) {
      focusChannelList();
      return;
    }
    if (isFullscreen()) {
      exitFullscreen();
      focusChannelList();
      return;
    }
    if (isTvLayout() && onPlayer && currentFocus.col === TV_HEADER_COL) {
      focusTvCategoryColumn();
      updateCursorVisuals();
      return;
    }
    if (isTvLayout() && onPlayer && currentFocus.col === 1) {
      focusTvCategoryColumn();
      updateCursorVisuals();
      return;
    }
    setDebugOpen(false);
    return;
  }

  if (isYellowKey(e) && isTvLayout() && onPlayer) {
    e.preventDefault();
    toggleTvFavorite();
    return;
  }

  if (e.key === " " || e.key === "MediaPlayPause" || e.key === "MediaPlay") {
    if (isLoginScreenActive() || isTypingTarget(e.target) || !video) return;
    e.preventDefault();
    if (video.paused) video.play();
    else video.pause();
    return;
  }

  if (isLoginScreenActive()) {
    const reload = document.getElementById("forceReloadBtn");
    if (reload && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      reload.classList.add("login-focus");
      try {
        reload.focus({ preventScroll: true });
      } catch (err) {
        reload.focus();
      }
    }
    return;
  }

  const validKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "OK", "Select"];
  if (!validKeys.includes(e.key) && !isConfirmKey(e)) return;

  if (isConfirmKey(e) && isTvLayout() && currentFocus.col === 1) {
    if (e.repeat) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    tvOkHoldFired = false;
    clearTvOkHold();
    tvOkHoldTimer = setTimeout(() => {
      tvOkHoldFired = true;
      toggleTvFavorite();
    }, 550);
    return;
  }

  const fullscreen = isFullscreen() || nativeFullscreen;

  if (!isTvLayout() && (fullscreen || currentFocus.col === 2)) {
    if (isConfirmKey(e)) {
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

  if (isTvLayout()) e.preventDefault();
  else if (e.key !== "Enter" && !isConfirmKey(e)) e.preventDefault();

  const categories = document.querySelectorAll(".category-btn");
  const channels = document.querySelectorAll(".channel-item");
  const headerActions = getTvHeaderActions();

  if (currentFocus.col === TV_HEADER_COL && isTvLayout()) {
    if (e.key === "ArrowRight" && currentFocus.row < headerActions.length - 1) currentFocus.row++;
    else if (e.key === "ArrowLeft" && currentFocus.row > 0) currentFocus.row--;
    else if (e.key === "ArrowDown") {
      focusTvCategoryColumn();
      updateCursorVisuals();
      return;
    } else if (isConfirmKey(e) && headerActions[currentFocus.row]) {
      headerActions[currentFocus.row].click();
      return;
    }
    updateCursorVisuals();
    return;
  }

  if (e.key === "ArrowRight") {
    if (currentFocus.col === 0) {
      if (isTvLayout()) enterTvChannelsColumn();
      else if (channels.length > 0) {
        currentFocus.col = 1;
        currentFocus.row = 0;
      }
    }
  } else if (e.key === "ArrowLeft") {
    if (currentFocus.col === 1 && categories.length > 0) {
      focusTvCategoryColumn();
    }
  } else if (e.key === "ArrowDown") {
    if (currentFocus.col === 0 && currentFocus.row < categories.length - 1) {
      currentFocus.row++;
      if (isTvLayout() && categories[currentFocus.row]) {
        selectCategory(categories[currentFocus.row].dataset.category, { keepFocus: true });
      }
    } else if (currentFocus.col === 1) {
      if (isTvLayout()) {
        if (currentFocus.row < virtualList.length - 1) {
          currentFocus.row++;
          ensureTvChannelVisible();
        }
      } else if (currentFocus.row < channels.length - 1) currentFocus.row++;
    }
  } else if (e.key === "ArrowUp") {
    if (currentFocus.col === 0 && currentFocus.row > 0) {
      currentFocus.row--;
      if (isTvLayout() && categories[currentFocus.row]) {
        selectCategory(categories[currentFocus.row].dataset.category, { keepFocus: true });
      }
    } else if (currentFocus.col === 0 && currentFocus.row <= 0 && isTvLayout()) {
      focusTvHeader(0);
      updateCursorVisuals();
      return;
    } else if (currentFocus.col === 1 && currentFocus.row > 0) {
      if (isTvLayout()) {
        currentFocus.row--;
        ensureTvChannelVisible();
      } else currentFocus.row--;
    } else if (currentFocus.col === 1 && currentFocus.row <= 0 && isTvLayout()) {
      focusTvHeader(0);
      updateCursorVisuals();
      return;
    }
  } else if (isConfirmKey(e)) {
    if (currentFocus.col === 0 && categories[currentFocus.row]) {
      if (isTvLayout()) enterTvChannelsColumn();
      else {
        currentFocus.col = 1;
        currentFocus.row = 0;
      }
    } else if (currentFocus.col === 1) {
      if (isTvLayout()) activateTvChannel();
      else if (channels[currentFocus.row]) channels[currentFocus.row].click();
    }
  }
  updateCursorVisuals();
});

document.addEventListener("keyup", (e) => {
  if (!isTvLayout() || !isConfirmKey(e) || currentFocus.col !== 1) return;
  if (isLoginScreenActive() || isSplashActive()) return;
  e.preventDefault();
  const held = tvOkHoldFired;
  clearTvOkHold();
  tvOkHoldFired = false;
  if (!held) activateTvChannel();
});

function updateCursorVisuals() {
  document.querySelectorAll(".category-btn, .channel-item").forEach((el) => el.classList.remove("cursor"));
  getTvHeaderActions().forEach((el) => el.classList.remove("cursor"));
  let target = null;
  if (currentFocus.col === TV_HEADER_COL) {
    const actions = getTvHeaderActions();
    target = actions[currentFocus.row] || actions[0];
    if (target) {
      target.classList.add("cursor");
      if (document.activeElement !== target) {
        try {
          target.focus({ preventScroll: true });
        } catch (e) {
          target.focus();
        }
      }
    }
    if (video) video.style.outline = "none";
    return;
  }
  if (currentFocus.col === 0) {
    target = document.querySelectorAll(".category-btn")[currentFocus.row];
  } else if (currentFocus.col === 1) {
    const ch = virtualList[currentFocus.row];
    if (ch && channelsContainer) {
      target = channelsContainer.querySelector('.channel-item[data-id="' + CSS.escape(String(ch.id)) + '"]');
    }
    if (!target) target = document.querySelectorAll(".channel-item")[currentFocus.row];
  }
  if (video) video.style.outline = "none";
  const headerActive = document.activeElement;
  if (headerActive && getTvHeaderActions().indexOf(headerActive) >= 0) headerActive.blur();
  if (target) {
    target.classList.add("cursor");
    target.scrollIntoView({ block: "nearest", behavior: "auto" });
    if (currentFocus.col === 0 && !isTvLayout()) {
      selectCategory(target.dataset.category);
    }
  }
}

const debugProbeBtn = document.getElementById("debugProbeBtn");
if (debugProbeBtn) debugProbeBtn.addEventListener("click", probeStream);

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
