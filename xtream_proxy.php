<?php
/**
 * XTREAM PROXY — solo player_api.php y get.php hacia el servidor configurado.
 */
require_once __DIR__ . '/config.php';

$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if ($origin) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
} else {
    header('Access-Control-Allow-Origin: *');
}
header('Access-Control-Allow-Methods: GET, OPTIONS');
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
    echo json_encode(array('error' => 'Endpoint no permitido'));
    exit;
}

$allowedParams = array('username', 'password', 'type', 'output');
$params = array_intersect_key($_GET, array_flip($allowedParams));

$url = rtrim(XTREAM_SERVER, '/') . '/' . $endpoint;
if (!empty($params)) {
    $url .= '?' . http_build_query($params);
}

$ch = curl_init($url);
curl_setopt_array($ch, array(
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_HTTPHEADER => array('User-Agent: Mozilla/5.0 (StreamBox IPTV)'),
));
$response = curl_exec($ch);
$httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

if ($error) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('error' => 'Error de conexión'));
    exit;
}

http_response_code($httpCode > 0 ? $httpCode : 200);

if ($endpoint === 'player_api.php') {
    header('Content-Type: application/json; charset=utf-8');
} else {
    header('Content-Type: text/plain; charset=utf-8');
}
echo $response;
