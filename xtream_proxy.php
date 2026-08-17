<?php
/**
 * XTREAM PROXY — solo player_api.php y get.php hacia el servidor configurado.
 * Comportamiento curl del proxy original (HTTP, redirects, gzip, SSL verify off)
 * sin convertirse en proxy abierto (sin server/direct_url arbitrarios).
 */
require_once __DIR__ . '/config.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$endpoint = isset($_GET['endpoint']) ? $_GET['endpoint'] : '';
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

$params = $_GET;
unset($params['endpoint'], $params['server'], $params['direct_url'], $params['url'], $params['u']);

$url = rtrim(XTREAM_SERVER, '/') . '/' . $endpoint;
if (!empty($params)) {
    $url .= '?' . http_build_query($params);
}

$ua = isset($_SERVER['HTTP_USER_AGENT']) && $_SERVER['HTTP_USER_AGENT'] !== ''
    ? $_SERVER['HTTP_USER_AGENT']
    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
curl_setopt($ch, CURLOPT_TIMEOUT, 120);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 15);
curl_setopt($ch, CURLOPT_ENCODING, '');
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
curl_setopt($ch, CURLOPT_USERAGENT, $ua);
if (defined('CURL_HTTP_VERSION_1_1')) {
    curl_setopt($ch, CURLOPT_HTTP_VERSION, CURL_HTTP_VERSION_1_1);
}

$response = curl_exec($ch);
$httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
$errno = curl_errno($ch);
curl_close($ch);

if ($response === false || $errno || $httpCode <= 0 || ($httpCode >= 300 && $httpCode < 400)) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array(
        'error' => 'proxy_error',
        'message' => 'No se pudo conectar con el servidor Xtream',
    ));
    exit;
}

http_response_code($httpCode);

if ($endpoint === 'player_api.php') {
    header('Content-Type: application/json; charset=utf-8');
} else {
    header('Content-Type: text/plain; charset=utf-8');
}
echo $response;
