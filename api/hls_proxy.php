<?php
require_once dirname(__DIR__) . '/config.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Range');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$u = isset($_GET['u']) ? $_GET['u'] : (isset($_GET['url']) ? $_GET['url'] : '');
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

if (!player_host_allowed($u)) {
    http_response_code(403);
    echo 'Host no permitido';
    exit;
}

define('USER_AGENT', 'Mozilla/5.0 (StreamBox IPTV) AppleWebKit/537.36');
$proxyPath = isset($_SERVER['SCRIPT_NAME']) && $_SERVER['SCRIPT_NAME']
    ? $_SERVER['SCRIPT_NAME']
    : '/player/api/hls_proxy.php';

$uLower = strtolower($u);
$isM3U8 = (strpos($uLower, '.m3u8') !== false);

$range = isset($_SERVER['HTTP_RANGE']) ? $_SERVER['HTTP_RANGE'] : null;

if ($isM3U8) {
    $ch = curl_init($u);
    $headers = array('User-Agent: ' . USER_AGENT);
    if ($range) {
        $headers[] = 'Range: ' . $range;
    }
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HTTPHEADER => $headers,
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

    $port = isset($parts['port']) ? (':' . (int) $parts['port']) : '';
    $base = $scheme . '://' . $parts['host'] . $port;
    $path = isset($parts['path']) ? $parts['path'] : '/';
    $dir = rtrim(dirname($path), '/');
    $baseDir = $base . (($dir === '' || $dir === '.') ? '/' : ($dir . '/'));

    $lines = preg_split("/\r\n|\n|\r/", (string) $data);
    $out = array();

    foreach ($lines as $line) {
        $t = trim($line);

        if ($t !== '' && strpos($t, 'URI="') !== false) {
            $line2 = preg_replace_callback('/URI="([^"]+)"/', function ($m) use ($baseDir, $base, $proxyPath) {
                $uri = $m[1];
                if (preg_match('#^https?://#i', $uri)) {
                    $abs = $uri;
                } elseif (isset($uri[0]) && $uri[0] === '/') {
                    $abs = $base . $uri;
                } else {
                    $abs = $baseDir . $uri;
                }
                return 'URI="' . $proxyPath . '?u=' . rawurlencode($abs) . '"';
            }, $line);
            $out[] = $line2;
            continue;
        }

        if ($t === '' || (isset($t[0]) && $t[0] === '#')) {
            $out[] = $line;
            continue;
        }

        if (preg_match('#^https?://#i', $t)) {
            $abs = $t;
        } elseif (isset($t[0]) && $t[0] === '/') {
            $abs = $base . $t;
        } else {
            $abs = $baseDir . $t;
        }
        $out[] = $proxyPath . '?u=' . rawurlencode($abs);
    }

    echo implode("\n", $out);
    exit;
}

$upCode = 200;
$upCt = 'application/octet-stream';
$headerDone = false;
$seenStatusLine = false;

$ch = curl_init($u);
$reqHeaders = array('User-Agent: ' . USER_AGENT);
if ($range) {
    $reqHeaders[] = 'Range: ' . $range;
}

curl_setopt_array($ch, array(
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 0,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_HTTPHEADER => $reqHeaders,
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
    CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$headerDone, $uLower, &$upCt) {
        if (!$headerDone) {
            http_response_code(200);
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
