<?php
/**
 * XTREAM PROXY MEJORADO v2 - Soporta GZIP y Listas Gigantes
 * Restaurado del player.zip que funcionaba (cualquier servidor Xtream / URL M3U).
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

// 1. MODO LISTA M3U DIRECTA
if (isset($_GET['direct_url'])) {
    header('Content-Type: text/plain');
    $url = $_GET['direct_url'];

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 120);
    curl_setopt($ch, CURLOPT_ENCODING, '');
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

    $response = curl_exec($ch);
    curl_close($ch);

    if ($response) {
        echo $response;
    } else {
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

$params = $_GET;
unset($params['endpoint'], $params['server']);

$server = rtrim($server, '/');
$url = $server . '/' . $endpoint;

if (!empty($params)) {
    $url .= '?' . http_build_query($params);
}

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 120);
curl_setopt($ch, CURLOPT_ENCODING, '');
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

http_response_code($httpCode);

if (strpos($endpoint, 'player_api.php') !== false) {
    header('Content-Type: application/json');
} else {
    header('Content-Type: text/plain');
}
echo $response;
