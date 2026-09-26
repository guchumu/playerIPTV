<?php
require_once dirname(__DIR__) . '/player_lib.php';

// Mismo UA que stream.php / xtream: los paneles IPTV suelen aceptar VLC
// en fragmentos .ts y bloquear un navegador genérico.
define('HLS_USER_AGENT', 'VLC/3.0.16 LibVLC/3.0.16');

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Range');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

/**
 * Lee u / url / r de la query cruda. rawurldecode no convierte + en espacio
 * (urldecode / $_GET sí), así el token del panel sobrevive.
 */
function hls_request_param($name)
{
    $qs = isset($_SERVER['QUERY_STRING']) ? (string) $_SERVER['QUERY_STRING'] : '';
    if ($qs !== '') {
        foreach (explode('&', $qs) as $pair) {
            if ($pair === '') {
                continue;
            }
            $eq = strpos($pair, '=');
            $k = rawurldecode($eq === false ? $pair : substr($pair, 0, $eq));
            if ($k === $name) {
                return rawurldecode($eq === false ? '' : substr($pair, $eq + 1));
            }
        }
    }
    if (isset($_GET[$name]) && $_GET[$name] !== '') {
        return (string) $_GET[$name];
    }
    return '';
}

function hls_origin($parts)
{
    if (!$parts || empty($parts['scheme']) || empty($parts['host'])) {
        return '';
    }
    $port = isset($parts['port']) ? (':' . (int) $parts['port']) : '';
    return strtolower($parts['scheme']) . '://' . $parts['host'] . $port;
}

function hls_dir_base($parts)
{
    $origin = hls_origin($parts);
    $path = isset($parts['path']) ? $parts['path'] : '/';
    $dir = rtrim(dirname($path), '/');
    return $origin . (($dir === '' || $dir === '.') ? '/' : ($dir . '/'));
}

function hls_resolve_abs($uri, $origin, $baseDir)
{
    $uri = trim((string) $uri);
    $qpos = strpos($uri, '?');
    $path = $qpos === false ? $uri : substr($uri, 0, $qpos);
    $query = $qpos === false ? '' : substr($uri, $qpos + 1);

    if ($path === '') {
        $abs = $baseDir;
    } elseif (preg_match('#^https?://#i', $path)) {
        $abs = $path;
    } elseif (isset($path[0]) && $path[0] === '/') {
        $abs = $origin . $path;
    } else {
        $abs = $baseDir . $path;
    }
    return array($abs, $query);
}

function hls_merge_query($playlistQuery, $uriQuery)
{
    $playlistQuery = (string) $playlistQuery;
    $uriQuery = (string) $uriQuery;
    if ($playlistQuery === '') {
        return $uriQuery;
    }
    if ($uriQuery === '') {
        return $playlistQuery;
    }
    $extra = array();
    foreach (array('user', 'token', 'username', 'password', 'utc', 'lutc') as $key) {
        if (preg_match('/(?:^|&)' . preg_quote($key, '/') . '=/i', $uriQuery)) {
            continue;
        }
        if (preg_match('/(?:^|&)(' . preg_quote($key, '/') . '=[^&]*)/i', $playlistQuery, $m)) {
            $extra[] = $m[1];
        }
    }
    return $extra ? ($uriQuery . '&' . implode('&', $extra)) : $uriQuery;
}

function hls_absolute($uri, $origin, $baseDir, $playlistQuery)
{
    list($abs, $uriQuery) = hls_resolve_abs($uri, $origin, $baseDir);
    $qpos = strpos($abs, '?');
    if ($qpos !== false) {
        $uriQuery = $uriQuery === '' ? substr($abs, $qpos + 1) : (substr($abs, $qpos + 1) . '&' . $uriQuery);
        $abs = substr($abs, 0, $qpos);
    }
    $q = hls_merge_query($playlistQuery, $uriQuery);
    if ($q !== '') {
        $abs .= '?' . $q;
    }
    return $abs;
}

function hls_proxy_href($proxyPath, $abs, $refererUrl)
{
    $href = $proxyPath . '?u=' . rawurlencode($abs);
    if ($refererUrl !== '') {
        $href .= '&r=' . rawurlencode($refererUrl);
    }
    return $href;
}

function hls_upstream_headers($targetUrl, $refererUrl, $range)
{
    $headers = array(
        'User-Agent: ' . HLS_USER_AGENT,
        'Accept: */*',
    );
    $ref = $refererUrl !== '' ? $refererUrl : $targetUrl;
    if ($ref !== '') {
        $headers[] = 'Referer: ' . $ref;
        $rp = parse_url($ref);
        $origin = hls_origin($rp);
        if ($origin !== '') {
            $headers[] = 'Origin: ' . $origin;
        }
    }
    if ($range) {
        $headers[] = 'Range: ' . $range;
    }
    return $headers;
}

$u = hls_request_param('u');
if ($u === '') {
    $u = hls_request_param('url');
}
if ($u === '') {
    http_response_code(400);
    echo 'URL requerida';
    exit;
}

$parts = parse_url($u);
if (!$parts || empty($parts['scheme']) || empty($parts['host'])) {
    http_response_code(400);
    echo 'URL inválida';
    exit;
}

$scheme = strtolower($parts['scheme']);
if ($scheme !== 'http' && $scheme !== 'https') {
    http_response_code(400);
    echo 'Esquema no permitido';
    exit;
}

if (!player_url_ok($u)) {
    http_response_code(403);
    echo 'URL no permitida';
    exit;
}

$scriptName = isset($_SERVER['SCRIPT_NAME']) ? (string) $_SERVER['SCRIPT_NAME'] : '';
$proxyPath = basename($scriptName);
if ($proxyPath === '') {
    $proxyPath = 'hls_proxy.php';
}

$uLower = strtolower($u);
$isM3U8 = (strpos($uLower, '.m3u8') !== false);

$range = isset($_SERVER['HTTP_RANGE']) ? $_SERVER['HTTP_RANGE'] : null;
$origin = hls_origin($parts);
$baseDir = hls_dir_base($parts);
$playlistQuery = isset($parts['query']) ? $parts['query'] : '';

$referer = hls_request_param('r');
if ($referer === '' || !player_url_ok($referer)) {
    if ($isM3U8) {
        $referer = $u;
    } else {
        $referer = rtrim($baseDir, '/');
        $referer .= $playlistQuery !== '' ? ('/?' . $playlistQuery) : '/';
    }
}

if ($isM3U8) {
    $ch = curl_init($u);
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HTTPHEADER => hls_upstream_headers($u, $referer, $range),
        CURLOPT_USERAGENT => HLS_USER_AGENT,
    ));
    $data = curl_exec($ch);
    $errNo = curl_errno($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($data === false || $errNo) {
        http_response_code(502);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Proxy upstream error';
        exit;
    }

    http_response_code($code > 0 ? $code : 200);
    header('Content-Type: application/vnd.apple.mpegurl; charset=utf-8');
    header('Cache-Control: no-cache');

    $lines = preg_split("/\r\n|\n|\r/", (string) $data);
    $out = array();
    $playlistRef = $u;

    foreach ($lines as $line) {
        $t = trim($line);

        if ($t !== '' && strpos($t, 'URI="') !== false) {
            $line2 = preg_replace_callback('/URI="([^"]+)"/', function ($m) use ($origin, $baseDir, $playlistQuery, $proxyPath, $playlistRef) {
                $abs = hls_absolute($m[1], $origin, $baseDir, $playlistQuery);
                return 'URI="' . hls_proxy_href($proxyPath, $abs, $playlistRef) . '"';
            }, $line);
            $out[] = $line2;
            continue;
        }

        if ($t === '' || (isset($t[0]) && $t[0] === '#')) {
            $out[] = $line;
            continue;
        }

        $abs = hls_absolute($t, $origin, $baseDir, $playlistQuery);
        $out[] = hls_proxy_href($proxyPath, $abs, $playlistRef);
    }

    echo implode("\n", $out);
    exit;
}

$upCode = 200;
$upCt = 'application/octet-stream';
$headerDone = false;
$seenStatusLine = false;

$ch = curl_init($u);
curl_setopt_array($ch, array(
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 0,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_HTTPHEADER => hls_upstream_headers($u, $referer, $range),
    CURLOPT_USERAGENT => HLS_USER_AGENT,
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_HEADER => false,
    CURLOPT_HEADERFUNCTION => function ($ch, $headerLine) use (&$upCode, &$upCt, &$headerDone, &$seenStatusLine) {
        $line = trim($headerLine);
        if (preg_match('#^HTTP/\d+(?:\.\d+)?\s+(\d+)#i', $line, $m)) {
            $upCode = (int) $m[1];
            $upCt = 'application/octet-stream';
            $headerDone = false;
            $seenStatusLine = true;
            return strlen($headerLine);
        }
        if ($line === '' && $seenStatusLine && !$headerDone) {
            http_response_code($upCode);
            header('Content-Type: ' . $upCt);
            header('Cache-Control: max-age=60');
            $headerDone = true;
            return strlen($headerLine);
        }
        if (stripos($line, 'content-type:') === 0) {
            $val = trim(substr($line, strlen('content-type:')));
            if ($val !== '') {
                $upCt = $val;
            }
        }
        if (stripos($line, 'content-range:') === 0 || stripos($line, 'accept-ranges:') === 0) {
            header($line, false);
        }
        return strlen($headerLine);
    },
    CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$headerDone, $uLower, &$upCt, &$upCode) {
        if (!$headerDone) {
            http_response_code($upCode > 0 ? $upCode : 200);
            if (strpos($uLower, '.ts') !== false) {
                $upCt = 'video/mp2t';
            }
            header('Content-Type: ' . $upCt);
            header('Cache-Control: max-age=60');
            $headerDone = true;
        }
        echo $chunk;
        if (function_exists('flush')) {
            flush();
        }
        return strlen($chunk);
    },
));

if (strpos($uLower, '.ts') !== false) {
    $upCt = 'video/mp2t';
}

curl_exec($ch);
$errNo = curl_errno($ch);
curl_close($ch);

if ($errNo && !headers_sent()) {
    http_response_code(502);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Proxy upstream error';
}
