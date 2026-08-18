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

if (!player_rate_limit('xtream', 40, 60)) {
    http_response_code(429);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('error' => 'Demasiadas peticiones'));
    exit;
}

function xtream_fetch($url, $timeout = 120)
{
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
    curl_setopt($ch, CURLOPT_ENCODING, '');
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return array($response, $httpCode, $err);
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
    $cacheName = 'm3u_' . md5($url) . '.txt';
    $cached = player_cache_get($cacheName, M3U_CACHE_TTL);
    if ($cached !== null) {
        echo $cached;
        exit;
    }
    list($response, $httpCode, $err) = xtream_fetch($url);
    if ($response) {
        player_cache_set($cacheName, $response);
        echo $response;
    } else {
        player_log('m3u directa fallo ' . $httpCode . ' ' . $err);
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
    // player_url_ok needs a path-ish url; check host via fake path
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
$cacheName = $isList ? 'm3u_' . md5($url) . '.txt' : '';
if ($isList) {
    $cached = player_cache_get($cacheName, M3U_CACHE_TTL);
    if ($cached !== null) {
        header('Content-Type: text/plain; charset=utf-8');
        echo $cached;
        exit;
    }
}

list($response, $httpCode, $err) = xtream_fetch($url);
if ($response === false || $response === null) {
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
if ($isList && $response) {
    player_cache_set($cacheName, $response);
}
echo $response;
