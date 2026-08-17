<?php
/**
 * XTREAM PROXY — curl del backup que funcionaba (HTTP, redirects, gzip, SSL verify off)
 * más allowlist de hosts (no es un proxy abierto).
 */
require_once __DIR__ . '/config.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

function player_proxy_curl($url)
{
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 120);
    curl_setopt($ch, CURLOPT_ENCODING, '');
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    $response = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $errno = curl_errno($ch);
    $error = curl_error($ch);
    curl_close($ch);
    return array($response, $httpCode, $errno, $error);
}

function player_proxy_fail($message)
{
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array(
        'error' => 'proxy_error',
        'message' => $message,
    ));
    exit;
}

function player_proxy_forbid($message)
{
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array(
        'error' => 'proxy_error',
        'message' => $message,
    ));
    exit;
}

// 1. MODO LISTA M3U DIRECTA
if (isset($_GET['direct_url'])) {
    $url = $_GET['direct_url'];
    if (!filter_var($url, FILTER_VALIDATE_URL) || !player_host_allowed($url)) {
        player_proxy_forbid('Host no permitido');
    }

    list($response, $httpCode, $errno) = player_proxy_curl($url);
    header('Content-Type: text/plain; charset=utf-8');
    if ($response === false || $errno) {
        echo 'Error al cargar la lista M3U.';
        exit;
    }
    if ($httpCode > 0) {
        http_response_code($httpCode);
    }
    echo $response;
    exit;
}

// 2. MODO XTREAM CODES DINÁMICO
$endpoint = isset($_GET['endpoint']) ? $_GET['endpoint'] : '';
$server = isset($_GET['server']) ? $_GET['server'] : XTREAM_SERVER;

if ($endpoint === '') {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('error' => 'Endpoint no especificado'));
    exit;
}

$allowedEndpoints = array('player_api.php', 'get.php');
if (!in_array($endpoint, $allowedEndpoints, true)) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array(
        'error' => 'proxy_error',
        'message' => 'Endpoint no permitido',
    ));
    exit;
}

if (!player_host_allowed($server)) {
    player_proxy_forbid('Host no permitido');
}

$params = $_GET;
unset($params['endpoint'], $params['server'], $params['direct_url'], $params['url'], $params['u']);

$server = rtrim($server, '/');
$url = $server . '/' . $endpoint;
if (!empty($params)) {
    $url .= '?' . http_build_query($params);
}

list($response, $httpCode, $errno) = player_proxy_curl($url);

if ($response === false || $errno || $httpCode <= 0) {
    player_proxy_fail('No se pudo conectar con el servidor Xtream');
}

http_response_code($httpCode);

if (strpos($endpoint, 'player_api.php') !== false) {
    header('Content-Type: application/json; charset=utf-8');
} else {
    header('Content-Type: text/plain; charset=utf-8');
}
echo $response;
