<?php
/**
 * stream.php — proxy de vídeo TS del backup (streaming, UA VLC)
 * con allowlist de hosts.
 */
require_once __DIR__ . '/config.php';

set_time_limit(0);
@ob_end_clean();

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Range');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if (!isset($_GET['url']) || $_GET['url'] === '') {
    http_response_code(400);
    echo 'No hay URL de vídeo';
    exit;
}

$url = $_GET['url'];
if (!filter_var($url, FILTER_VALIDATE_URL) || !player_host_allowed($url)) {
    http_response_code(403);
    echo 'URL no permitida';
    exit;
}

$userAgent = 'VLC/3.0.16 LibVLC/3.0.16';
header('Content-Type: video/mp2t');

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_USERAGENT, $userAgent);
curl_exec($ch);
curl_close($ch);
