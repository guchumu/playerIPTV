<?php
require_once dirname(__DIR__) . '/player_lib.php';

// Sin notices/BOM/echo extra: un byte de más y hls.js no encuentra el sync 0x47.
@ini_set('display_errors', '0');
@ini_set('display_startup_errors', '0');
@ini_set('html_errors', '0');
@ini_set('zlib.output_compression', '0');
ignore_user_abort(true);
set_time_limit(0);
while (ob_get_level() > 0) {
    @ob_end_clean();
}

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
                $v = rawurldecode($eq === false ? '' : substr($pair, $eq + 1));
                return hls_unescape_u($name, $v);
            }
        }
    }
    if (isset($_GET[$name]) && $_GET[$name] !== '') {
        return hls_unescape_u($name, (string) $_GET[$name]);
    }
    return '';
}

/**
 * Si el relé recibió u doble-codificado (http%3A%2F%2F...), una pasada más.
 * No toca el token interno: solo detecta que TODA la URL sigue percent-encoded.
 */
function hls_unescape_u($name, $v)
{
    $v = trim((string) $v);
    if (($name === 'u' || $name === 'url' || $name === 'r')
        && preg_match('#^https?%3A%2F%2F#i', $v)
    ) {
        $v = rawurldecode($v);
    }
    return $v;
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

function hls_url_path($url)
{
    $path = parse_url((string) $url, PHP_URL_PATH);
    return strtolower((string) $path);
}

function hls_is_playlist_path($url)
{
    return (bool) preg_match('/\.m3u8?$/i', hls_url_path($url));
}

function hls_is_segment_path($url)
{
    return (bool) preg_match('/\.(ts|m4s|m4a|aac|mp4|mp3)$/i', hls_url_path($url));
}

function hls_looks_playlist($data)
{
    $s = ltrim((string) $data);
    return strncmp($s, '#EXTM3U', 7) === 0;
}

function hls_looks_html($data)
{
    $s = ltrim((string) $data);
    if ($s === '') {
        return false;
    }
    $c = $s[0];
    if ($c === '<' || $c === '{') {
        return true;
    }
    return strncasecmp($s, '<!doctype', 9) === 0 || strncasecmp($s, '<html', 5) === 0;
}

function hls_already_proxied($uri)
{
    return stripos((string) $uri, 'hls_proxy.php') !== false;
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

/**
 * u es SIEMPRE rawurlencoded entero (incluido ?user=&token=). Nada de & crudos
 * dentro de u: PHP cortaría el token en el primer &.
 */
function hls_proxy_href($proxyPath, $abs, $refererUrl)
{
    $href = $proxyPath . '?u=' . rawurlencode($abs);
    if ($refererUrl !== '') {
        $href .= '&r=' . rawurlencode($refererUrl);
    }
    return $href;
}

function hls_rewrite_playlist($data, $playlistUrl, $proxyPath)
{
    $parts = parse_url($playlistUrl);
    $origin = hls_origin($parts);
    $baseDir = hls_dir_base($parts);
    $playlistQuery = isset($parts['query']) ? $parts['query'] : '';
    $playlistRef = $playlistUrl;

    $lines = preg_split("/\r\n|\n|\r/", (string) $data);
    $out = array();

    foreach ($lines as $line) {
        $t = trim($line);

        if ($t !== '' && strpos($t, 'URI="') !== false) {
            $line2 = preg_replace_callback('/URI="([^"]+)"/', function ($m) use ($origin, $baseDir, $playlistQuery, $proxyPath, $playlistRef) {
                if (hls_already_proxied($m[1])) {
                    return $m[0];
                }
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

        if (hls_already_proxied($t)) {
            $out[] = $t;
            continue;
        }

        $abs = hls_absolute($t, $origin, $baseDir, $playlistQuery);
        $out[] = hls_proxy_href($proxyPath, $abs, $playlistRef);
    }

    return implode("\n", $out);
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

function hls_proxy_script_path()
{
    $scriptName = isset($_SERVER['SCRIPT_NAME']) ? (string) $_SERVER['SCRIPT_NAME'] : '';
    $base = basename($scriptName);
    if ($base === '') {
        $base = 'hls_proxy.php';
    }
    // Relativo al directorio del relé (/player/api/), no al de la página.
    return $base;
}

function hls_emit_playlist_body($body, $code, $playlistUrl, $proxyPath)
{
    http_response_code($code > 0 ? $code : 200);
    header('Content-Type: application/vnd.apple.mpegurl; charset=utf-8');
    header('Cache-Control: no-cache');
    echo hls_rewrite_playlist($body, $playlistUrl, $proxyPath);
}

function hls_fetch_string($targetUrl, $refererUrl, $range, $timeout)
{
    $ch = curl_init($targetUrl);
    if ($ch === false) {
        return array(false, 0, 0, '');
    }
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HTTPHEADER => hls_upstream_headers($targetUrl, $refererUrl, $range),
        CURLOPT_USERAGENT => HLS_USER_AGENT,
        CURLOPT_ENCODING => '',
        CURLOPT_HEADER => false,
    ));
    $data = curl_exec($ch);
    $errNo = curl_errno($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $finalUrl = (string) curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
    curl_close($ch);
    return array($data, $errNo, $code, $finalUrl);
}

function hls_fail_upstream()
{
    http_response_code(502);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Proxy upstream error';
    exit;
}

if (getenv('HLS_PROXY_LIB_ONLY')) {
    return;
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

$proxyPath = hls_proxy_script_path();
$range = isset($_SERVER['HTTP_RANGE']) ? $_SERVER['HTTP_RANGE'] : null;
$origin = hls_origin($parts);
$baseDir = hls_dir_base($parts);
$playlistQuery = isset($parts['query']) ? $parts['query'] : '';

$referer = hls_request_param('r');
if ($referer === '' || !player_url_ok($referer)) {
    if (hls_is_playlist_path($u)) {
        $referer = $u;
    } else {
        // Referer = lista de origen (mismo dir + query), no la URL del relé.
        $referer = $baseDir;
        $baseName = basename(isset($parts['path']) ? $parts['path'] : '');
        $stem = preg_replace('/_[0-9]+\.(ts|m4s|m4a|aac|mp4|mp3)$/i', '.m3u8', $baseName);
        if ($stem === $baseName) {
            $stem = preg_replace('/\.(ts|m4s|m4a|aac|mp4|mp3)$/i', '.m3u8', $baseName);
        }
        if ($stem && preg_match('/\.m3u8$/i', $stem)) {
            $referer = $baseDir . $stem;
        }
        if ($playlistQuery !== '') {
            $referer .= (strpos($referer, '?') === false ? '?' : '&') . $playlistQuery;
        }
        if (!player_url_ok($referer)) {
            $referer = $u;
        }
    }
}

$wantPlaylist = hls_is_playlist_path($u);
$wantSegment = hls_is_segment_path($u);

if ($wantPlaylist) {
    list($data, $errNo, $code, $finalUrl) = hls_fetch_string($u, $referer, $range, 25);
    if ($data === false || $errNo) {
        hls_fail_upstream();
    }
    $rewriteUrl = ($finalUrl !== '' && preg_match('#^https?://#i', $finalUrl)) ? $finalUrl : $u;
    if (!hls_looks_playlist($data) && $wantPlaylist) {
        // El origen contestó la lista con otra cosa; aún así reescribimos si
        // parece texto HLS, si no devolvemos el cuerpo tal cual (no como TS).
        if (hls_looks_html($data)) {
            http_response_code($code > 0 ? $code : 502);
            header('Content-Type: text/plain; charset=utf-8');
            echo 'Proxy upstream HTML';
            exit;
        }
    }
    hls_emit_playlist_body($data, $code, $rewriteUrl, $proxyPath);
    exit;
}

// Segmento (.ts/.m4s/…) o URL sin extensión: FILE + peek, nunca reescribir
// solo porque el Referer lleve .m3u8.
$tmp = @fopen('php://temp', 'w+b');
if ($tmp === false) {
    hls_fail_upstream();
}

$upCode = 200;
$upCt = $wantSegment ? 'video/mp2t' : 'application/octet-stream';
$upRange = '';
$upAccept = '';

$ch = curl_init($u);
curl_setopt_array($ch, array(
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_TIMEOUT => 0,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_HTTPHEADER => hls_upstream_headers($u, $referer, $range),
    CURLOPT_USERAGENT => HLS_USER_AGENT,
    CURLOPT_ENCODING => '',
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_FILE => $tmp,
    CURLOPT_HEADER => false,
    CURLOPT_HEADERFUNCTION => function ($ch, $headerLine) use (&$upCode, &$upCt, &$upRange, &$upAccept) {
        $line = trim($headerLine);
        if (preg_match('#^HTTP/\d+(?:\.\d+)?\s+(\d+)#i', $line, $m)) {
            $upCode = (int) $m[1];
            return strlen($headerLine);
        }
        if (stripos($line, 'content-type:') === 0) {
            $val = trim(substr($line, strlen('content-type:')));
            if ($val !== '') {
                $upCt = $val;
            }
        }
        if (stripos($line, 'content-range:') === 0) {
            $upRange = $line;
        }
        if (stripos($line, 'accept-ranges:') === 0) {
            $upAccept = $line;
        }
        return strlen($headerLine);
    },
));

$ok = curl_exec($ch);
$errNo = curl_errno($ch);
$finalUrl = (string) curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
$httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
if ($httpCode > 0) {
    $upCode = $httpCode;
}
curl_close($ch);

if ($ok === false || $errNo) {
    fclose($tmp);
    hls_fail_upstream();
}

rewind($tmp);
$head = fread($tmp, 512);
if ($head === false) {
    $head = '';
}

$finalIsPlaylist = hls_is_playlist_path($finalUrl !== '' ? $finalUrl : $u);

if (hls_looks_playlist($head) || ($finalIsPlaylist && !$wantSegment)) {
    $body = $head . stream_get_contents($tmp);
    fclose($tmp);
    $rewriteUrl = $u;
    if ($finalUrl !== '' && hls_is_playlist_path($finalUrl)) {
        $rewriteUrl = $finalUrl;
    } elseif ($referer !== '' && hls_is_playlist_path($referer)) {
        $rewriteUrl = $referer;
    } elseif ($finalUrl !== '' && preg_match('#^https?://#i', $finalUrl)) {
        $rewriteUrl = $finalUrl;
    }
    hls_emit_playlist_body($body, $upCode, $rewriteUrl, $proxyPath);
    exit;
}

if ($wantSegment && hls_looks_html($head)) {
    fclose($tmp);
    http_response_code($upCode >= 400 ? $upCode : 502);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Proxy upstream HTML';
    exit;
}

if ($wantSegment || preg_match('/\.(ts)$/i', hls_url_path($u))) {
    $upCt = 'video/mp2t';
}

http_response_code($upCode > 0 ? $upCode : 200);
header('Content-Type: ' . $upCt);
header('Cache-Control: max-age=60');
if ($upRange !== '') {
    header($upRange, false);
}
if ($upAccept !== '') {
    header($upAccept, false);
}

echo $head;
fpassthru($tmp);
fclose($tmp);
