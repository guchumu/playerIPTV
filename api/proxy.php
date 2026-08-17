<?php
require_once dirname(__DIR__) . '/config.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: *');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

$url = isset($_GET['url']) ? $_GET['url'] : '';
if ($url === '' || !player_host_allowed($url)) {
    http_response_code(403);
    die('URL no permitida');
}

$_GET['u'] = $url;
require __DIR__ . '/hls_proxy.php';
