<?php
// stream.php - Proxy de vídeo en directo (player.zip)
set_time_limit(0);
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (isset($_GET['url'])) {
    $url = $_GET['url'];
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
} else {
    echo 'No hay URL de vídeo';
}
