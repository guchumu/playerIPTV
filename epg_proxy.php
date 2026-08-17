<?php
/**
 * EPG PROXY CON CACHÉ (backup XMLTV + fuente de config.php)
 */
require_once __DIR__ . '/config.php';

$remote_url = defined('EPG_SOURCE') ? EPG_SOURCE : 'https://raw.githubusercontent.com/davidmuma/EPG_dobleM/master/guiatv.xml';
$cache_file = __DIR__ . '/epg_cache.xml';
$cache_time = defined('EPG_CACHE_TTL') ? (int) EPG_CACHE_TTL : (24 * 3600);
if ($cache_time < 3600) {
    $cache_time = 24 * 3600;
}

header('Content-Type: text/xml; charset=utf-8');
header('Access-Control-Allow-Origin: *');

if (file_exists($cache_file) && (time() - filemtime($cache_file)) < $cache_time) {
    readfile($cache_file);
    exit;
}

$options = array(
    'http' => array('header' => "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n"),
    'ssl' => array('verify_peer' => false, 'verify_peer_name' => false),
);
$context = stream_context_create($options);
$xml_data = @file_get_contents($remote_url, false, $context);

if ($xml_data !== false) {
    @file_put_contents($cache_file, $xml_data);
    echo $xml_data;
} elseif (file_exists($cache_file)) {
    readfile($cache_file);
} else {
    http_response_code(500);
    echo '<?xml version="1.0"?><error>Error EPG</error>';
}
