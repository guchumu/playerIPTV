<?php
/**
 * Proxy Xtream / M3U. Cachea las listas unos minutos para no pedirlas al
 * proveedor en cada entrada, y limita por IP para que no sea un abridor
 * de internet genérico.
 */
require_once __DIR__ . '/player_lib.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function xtream_resolve_url($url, $base)
{
    $url = trim((string) $url);
    if ($url === '') {
        return '';
    }
    if (preg_match('#^https?://#i', $url)) {
        return $url;
    }
    $bp = parse_url($base);
    if (!$bp || empty($bp['scheme']) || empty($bp['host'])) {
        return $url;
    }
    $origin = $bp['scheme'] . '://' . $bp['host'] . (isset($bp['port']) ? ':' . $bp['port'] : '');
    if (isset($url[0]) && $url[0] === '/') {
        return $origin . $url;
    }
    $dir = isset($bp['path']) ? $bp['path'] : '/';
    $dir = preg_replace('#/[^/]*$#', '/', $dir);
    if ($dir === '') {
        $dir = '/';
    }
    return $origin . $dir . $url;
}

function xtream_looks_html($body)
{
    $head = strtolower(ltrim(substr((string) $body, 0, 240)));
    return strpos($head, '<!doctype') === 0
        || strpos($head, '<html') === 0
        || strpos($head, '<head') === 0
        || strpos($head, '<body') === 0;
}

/**
 * Fetch URL with manual redirects.
 * CURLOPT_FOLLOWLOCATION often fails under Plesk open_basedir, which breaks
 * providers that 301 http→https (playlist portals like powerfhd.me).
 *
 * @return array{0:string|false,1:int,2:string,3:string} body, httpCode, err, finalUrl
 */
function xtream_fetch($url, $timeout = 120)
{
    if (!function_exists('curl_init')) {
        return array(false, 0, 'curl no disponible', $url);
    }
    $current = $url;
    $response = false;
    $httpCode = 0;
    $err = '';
    for ($hop = 0; $hop < 6; $hop++) {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $current);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 6);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
        curl_setopt($ch, CURLOPT_ENCODING, '');
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        curl_setopt($ch, CURLOPT_USERAGENT, 'VLC/3.0.16 LibVLC/3.0.16');
        curl_setopt($ch, CURLOPT_HTTPHEADER, array(
            'Accept: audio/x-mpegurl, application/vnd.apple.mpegurl, text/plain, */*',
        ));
        curl_setopt($ch, CURLOPT_HEADER, true);
        $raw = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        $err = (string) curl_error($ch);
        curl_close($ch);
        if ($raw === false) {
            return array(false, $httpCode, $err !== '' ? $err : 'sin respuesta', $current);
        }
        $rawHeaders = substr($raw, 0, max(0, $headerSize));
        $response = substr($raw, max(0, $headerSize));
        if ($httpCode >= 300 && $httpCode < 400) {
            $loc = '';
            if (preg_match('/^Location:\s*(.+)$/im', $rawHeaders, $lm)) {
                $loc = trim($lm[1]);
            }
            if ($loc === '') {
                break;
            }
            $next = xtream_resolve_url($loc, $current);
            if (!player_url_ok($next) || $next === $current) {
                break;
            }
            $current = $next;
            continue;
        }
        break;
    }
    return array($response, $httpCode, $err, $current);
}

/**
 * Playlist fetch: follow redirects and, if started as http://, also try https://.
 */
function xtream_fetch_playlist($url, $timeout = 120)
{
    $tries = array($url);
    if (stripos($url, 'http://') === 0) {
        $tries[] = 'https://' . substr($url, 7);
    }
    $last = array(false, 0, '', $url);
    foreach ($tries as $try) {
        $res = xtream_fetch($try, $timeout);
        $body = isset($res[0]) ? $res[0] : false;
        $code = isset($res[1]) ? (int) $res[1] : 0;
        $err = isset($res[2]) ? (string) $res[2] : '';
        $final = isset($res[3]) ? (string) $res[3] : $try;
        $last = array($body, $code, $err, $final);
        if (
            is_string($body)
            && $body !== ''
            && !xtream_looks_html($body)
            && (stripos($body, '#EXTM3U') !== false || stripos($body, '#EXTINF') !== false)
        ) {
            return $last;
        }
        if ($err !== '' && stripos($err, 'timed out') !== false) {
            return $last;
        }
    }
    return $last;
}

function xtream_rate_or_fail()
{
    if (player_rate_limit('xtream', 80, 60)) {
        return;
    }
    http_response_code(429);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('error' => 'Demasiadas peticiones'));
    exit;
}

function xtream_m3u_is_cacheable($body)
{
    if (!$body || strlen($body) < 48 || xtream_looks_html($body)) {
        return false;
    }
    $n = preg_match_all('/#EXTINF:/i', $body);
    return $n >= 3;
}

const M3U_CACHE_TTL = 480;

// 1. MODO LISTA M3U DIRECTA
if (isset($_GET['direct_url'])) {
    header('Content-Type: text/plain; charset=utf-8');
    $url = trim((string) $_GET['direct_url']);
    if (!player_url_ok($url)) {
        http_response_code(400);
        echo 'URL no válida.';
        exit;
    }
    $cacheKey = 'm3u_' . md5($url) . '.txt';
    $cached = player_cache_get($cacheKey, M3U_CACHE_TTL);
    if ($cached !== null && !xtream_looks_html($cached)) {
        echo $cached;
        exit;
    }
    xtream_rate_or_fail();
    $timeout = 25;
    if (stripos($url, '.m3u8') !== false && stripos($url, 'type=m3u') === false && stripos($url, 'get.php') === false) {
        $timeout = 12;
    }
    $candidates = array($url);
    if (preg_match('#^(https?://[^/:]+):80(/.*)$#i', $url, $m)) {
        $candidates[] = $m[1] . $m[2];
    }
    $response = false;
    $httpCode = 0;
    $err = '';
    foreach ($candidates as $tryUrl) {
        list($response, $httpCode, $err) = xtream_fetch_playlist($tryUrl, $timeout);
        if ($response && !xtream_looks_html($response) && (stripos($response, '#EXTINF') !== false || stripos($response, '#EXTM3U') !== false)) {
            $url = $tryUrl;
            break;
        }
    }
    if ($response && xtream_m3u_is_cacheable($response)) {
        player_cache_set($cacheKey, $response);
        if (stripos($url, 'http://') === 0) {
            player_cache_set('m3u_' . md5('https://' . substr($url, 7)) . '.txt', $response);
        }
        echo $response;
    } elseif (
        $response
        && !xtream_looks_html($response)
        && (stripos($response, '#EXTINF') !== false || stripos($response, '#EXTM3U') !== false)
    ) {
        echo $response;
    } else {
        player_log('m3u directa fallo ' . $httpCode . ' ' . $err);
        http_response_code(($httpCode >= 400) ? $httpCode : 502);
        echo 'Error al cargar la lista M3U.';
    }
    exit;
}

// 2. MODO XTREAM CODES DINÁMICO
$endpoint = isset($_GET['endpoint']) ? $_GET['endpoint'] : '';
$server = isset($_GET['server']) ? $_GET['server'] : 'http://masquecero.net';

if (empty($endpoint)) {
    http_response_code(400);
    echo json_encode(array('error' => 'Endpoint no especificado'));
    exit;
}

$allowed = array('player_api.php', 'get.php', 'xmltv.php');
$endpointBase = basename(parse_url($endpoint, PHP_URL_PATH) ?: $endpoint);
if (!in_array($endpointBase, $allowed, true)) {
    http_response_code(400);
    echo json_encode(array('error' => 'Endpoint no permitido'));
    exit;
}

if (!player_url_ok(rtrim($server, '/') . '/')) {
    $check = rtrim($server, '/') . '/x';
    if (!player_url_ok($check)) {
        http_response_code(400);
        echo json_encode(array('error' => 'Servidor no válido'));
        exit;
    }
}

$params = $_GET;
unset($params['endpoint'], $params['server']);

$server = rtrim($server, '/');
$url = $server . '/' . $endpointBase;
if (!empty($params)) {
    $url .= '?' . http_build_query($params);
}

$isList = ($endpointBase === 'get.php');
$cacheKey = $isList ? 'm3u_' . md5($url) . '.txt' : '';
if ($isList) {
    $cached = player_cache_get($cacheKey, M3U_CACHE_TTL);
    if ($cached !== null && !xtream_looks_html($cached)) {
        header('Content-Type: text/plain; charset=utf-8');
        echo $cached;
        exit;
    }
}

xtream_rate_or_fail();

if ($isList) {
    list($response, $httpCode, $err) = xtream_fetch_playlist($url);
} else {
    list($response, $httpCode, $err) = xtream_fetch($url);
}

if ($response === false || $response === null || ($isList && xtream_looks_html($response))) {
    player_log('xtream fallo ' . $endpointBase . ' ' . $httpCode . ' ' . $err);
    http_response_code($httpCode >= 400 ? $httpCode : 502);
    echo json_encode(array('error' => 'No se pudo conectar con el servidor Xtream'));
    exit;
}

http_response_code($httpCode ?: 200);
if ($endpointBase === 'player_api.php') {
    header('Content-Type: application/json; charset=utf-8');
} else {
    header('Content-Type: text/plain; charset=utf-8');
}
if ($isList && $response && xtream_m3u_is_cacheable($response)) {
    player_cache_set($cacheKey, $response);
}
echo $response;
