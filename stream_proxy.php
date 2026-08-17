<?php
require_once __DIR__ . '/config.php';

@ob_end_clean();
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, HEAD, OPTIONS');
header('Access-Control-Allow-Headers: *');
header('Access-Control-Expose-Headers: *');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$url = isset($_GET['url']) ? $_GET['url'] : '';
if ($url === '') {
    http_response_code(400);
    die('Error: URL no proporcionada');
}
$url = urldecode($url);

if (!filter_var($url, FILTER_VALIDATE_URL) || !player_host_allowed($url)) {
    http_response_code(403);
    die('Error: URL no permitida');
}

$_GET['u'] = $url;
require __DIR__ . '/api/hls_proxy.php';
