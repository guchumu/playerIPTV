<?php
/**
 * Firma una URL de stream para que stream.php la acepte.
 * El secreto no sale al navegador: el player pide aquí el token corto.
 */
require_once __DIR__ . '/player_lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (!player_rate_limit('sign', 60, 60)) {
    http_response_code(429);
    echo json_encode(array('ok' => false, 'error' => 'Demasiadas peticiones'));
    exit;
}

$url = '';
if (isset($_POST['url'])) {
    $url = trim((string) $_POST['url']);
} elseif (isset($_GET['url'])) {
    $url = trim((string) $_GET['url']);
} else {
    $input = player_json_input();
    if (!empty($input['url'])) {
        $url = trim((string) $input['url']);
    }
}

if ($url === '' || !player_url_ok($url)) {
    http_response_code(400);
    echo json_encode(array('ok' => false, 'error' => 'URL no válida'));
    exit;
}

$signed = player_sign_stream($url);
$query = http_build_query(array(
    'url' => $signed['url'],
    'exp' => $signed['exp'],
    'sig' => $signed['sig'],
));

echo json_encode(array(
    'ok' => true,
    'href' => 'stream.php?' . $query,
    'exp' => $signed['exp'],
));
