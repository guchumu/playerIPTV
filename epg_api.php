<?php
/**
 * EPG API — convierte el XMLTV gigante en un JSON pequeño.
 *
 * El navegador ya no descarga ni parsea los ~32 MB de guiatv.xml: eso congelaba
 * la interfaz varios segundos. Aquí se hace una sola vez en el servidor con
 * XMLReader (streaming, sin cargar el XML entero en memoria) y se cachea el
 * resultado recortado a una ventana de horas.
 *
 * Formato de salida (claves cortas para que el JSON pese poco):
 *   u: timestamp de generación
 *   w: [inicio, fin] de la ventana cubierta
 *   c: { idCanal: [[inicio, fin, titulo], ...] }
 *   a: { nombreNormalizado: idCanal }
 */
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/player_lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=300');

@ini_set('memory_limit', '256M');
@set_time_limit(240);
ignore_user_abort(true);

// La ventana empieza en el pasado para que una caché vieja siga cubriendo "ahora".
define('EPG_WINDOW_PAST', 3 * 3600);
define('EPG_WINDOW_FUTURE', 18 * 3600);
define('EPG_MAX_PER_CHANNEL', 8);
define('EPG_JSON_TTL', 3 * 3600);
define('EPG_XML_TTL', 6 * 3600);
define('EPG_TITLE_MAX', 90);

function epg_cache_dir()
{
    $dir = __DIR__ . '/cache';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    if (is_dir($dir) && is_writable($dir)) {
        $htaccess = $dir . '/.htaccess';
        if (!is_file($htaccess)) {
            @file_put_contents($htaccess, "Deny from all\n");
        }
        return $dir;
    }
    return sys_get_temp_dir();
}

function epg_empty_payload()
{
    return json_encode(array('u' => 0, 'w' => array(0, 0), 'c' => new stdClass(), 'a' => new stdClass()));
}

/**
 * Debe dar exactamente el mismo resultado que normalizeEpgKey() de core.js;
 * si divergen, los canales dejan de emparejar con la guía.
 */
function epg_normalize_key($value)
{
    $value = (string) $value;
    $value = function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);

    // Mapa explícito en lugar de iconv: el resultado de //TRANSLIT depende del
    // locale del servidor y ahí es fácil que se desincronice con el cliente.
    $value = strtr($value, array(
        'á' => 'a', 'à' => 'a', 'ä' => 'a', 'â' => 'a', 'ã' => 'a', 'å' => 'a',
        'é' => 'e', 'è' => 'e', 'ë' => 'e', 'ê' => 'e',
        'í' => 'i', 'ì' => 'i', 'ï' => 'i', 'î' => 'i',
        'ó' => 'o', 'ò' => 'o', 'ö' => 'o', 'ô' => 'o', 'õ' => 'o',
        'ú' => 'u', 'ù' => 'u', 'ü' => 'u', 'û' => 'u',
        'ñ' => 'n', 'ç' => 'c', 'ý' => 'y',
    ));

    $value = preg_replace('/\([^)]*\)/', ' ', $value);
    $value = preg_replace('/\b(hd|fhd|uhd|4k|hevc|sd|tv)\b/', ' ', $value);
    $value = preg_replace('/[^a-z0-9]+/', '', $value);
    return (string) $value;
}

function epg_parse_time($value)
{
    if (!preg_match('/^\s*(\d{14})(?:\s*([+-]\d{4}))?/', (string) $value, $m)) {
        return 0;
    }
    $tz = !empty($m[2]) ? $m[2] : '+0000';
    $dt = DateTime::createFromFormat('YmdHis O', $m[1] . ' ' . $tz);
    return $dt ? $dt->getTimestamp() : 0;
}

/**
 * Descarga el XMLTV a disco. Va a fichero (no a memoria) porque son decenas de MB.
 */
function epg_download_xml($destination)
{
    $url = defined('EPG_SOURCE') ? EPG_SOURCE : '';
    if ($url === '' || !function_exists('curl_init')) {
        return false;
    }

    $tmp = $destination . '.part';
    $fp = @fopen($tmp, 'wb');
    if (!$fp) {
        return false;
    }

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_FILE, $fp);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 180);
    curl_setopt($ch, CURLOPT_ENCODING, '');
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    $ok = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    fclose($fp);

    if (!$ok || ($code >= 400) || @filesize($tmp) < 1024) {
        @unlink($tmp);
        return false;
    }

    return @rename($tmp, $destination);
}

function epg_pick_text(DOMElement $node, $tagName)
{
    $nodes = $node->getElementsByTagName($tagName);
    if (!$nodes->length) {
        return '';
    }
    $fallback = '';
    foreach ($nodes as $candidate) {
        $text = trim($candidate->textContent);
        if ($text === '') {
            continue;
        }
        if ($fallback === '') {
            $fallback = $text;
        }
        $lang = $candidate->getAttribute('lang');
        if ($lang === '' || stripos($lang, 'es') === 0) {
            return $text;
        }
    }
    return $fallback;
}

/**
 * Recorre el XMLTV y devuelve solo los programas de la ventana pedida.
 */
function epg_build_payload($xmlFile)
{
    if (!class_exists('XMLReader')) {
        return null;
    }

    $reader = new XMLReader();
    libxml_use_internal_errors(true);
    if (!@$reader->open($xmlFile)) {
        return null;
    }

    $now = time();
    $from = $now - EPG_WINDOW_PAST;
    $to = $now + EPG_WINDOW_FUTURE;

    $channels = array();
    $aliases = array();
    $doc = new DOMDocument();

    // El avance se controla a mano: next() ya deja el cursor sobre el siguiente
    // nodo, así que un read() adicional del while se saltaría ese elemento.
    $ok = @$reader->read();
    while ($ok) {
        if ($reader->nodeType !== XMLReader::ELEMENT) {
            $ok = @$reader->read();
            continue;
        }

        if ($reader->name === 'channel') {
            $id = (string) $reader->getAttribute('id');
            if ($id !== '') {
                $key = epg_normalize_key($id);
                if ($key !== '' && !isset($aliases[$key])) {
                    $aliases[$key] = $id;
                }
                $node = @$reader->expand($doc);
                if ($node instanceof DOMElement) {
                    foreach ($node->getElementsByTagName('display-name') as $nameNode) {
                        $nameKey = epg_normalize_key($nameNode->textContent);
                        if ($nameKey !== '' && !isset($aliases[$nameKey])) {
                            $aliases[$nameKey] = $id;
                        }
                    }
                }
            }
            $ok = @$reader->next();
            continue;
        }

        if ($reader->name !== 'programme') {
            $ok = @$reader->read();
            continue;
        }

        // Se filtra por atributos antes de expandir el nodo: descartar es mucho
        // más barato que construir el DOM de cada programa.
        $channelId = (string) $reader->getAttribute('channel');
        $start = epg_parse_time($reader->getAttribute('start'));
        $stop = epg_parse_time($reader->getAttribute('stop'));

        $usable = $channelId !== '' && $start > 0 && $stop > $start && $stop >= $from && $start <= $to;
        if ($usable && isset($channels[$channelId]) && count($channels[$channelId]) >= EPG_MAX_PER_CHANNEL) {
            $usable = false;
        }

        if (!$usable) {
            $ok = @$reader->next('programme');
            continue;
        }

        $node = @$reader->expand($doc);
        if ($node instanceof DOMElement) {
            $title = epg_pick_text($node, 'title');
            if ($title === '') {
                $title = 'Sin título';
            }
            if (function_exists('mb_substr')) {
                $title = mb_substr($title, 0, EPG_TITLE_MAX, 'UTF-8');
            } else {
                $title = substr($title, 0, EPG_TITLE_MAX);
            }

            if (!isset($channels[$channelId])) {
                $channels[$channelId] = array();
                $key = epg_normalize_key($channelId);
                if ($key !== '' && !isset($aliases[$key])) {
                    $aliases[$key] = $channelId;
                }
            }
            $channels[$channelId][] = array($start, $stop, $title);
        }

        $ok = @$reader->next('programme');
    }

    $reader->close();

    foreach ($channels as $id => $list) {
        usort($channels[$id], function ($a, $b) {
            return $a[0] - $b[0];
        });
    }

    return json_encode(
        array(
            'u' => $now,
            'w' => array($from, $to),
            'c' => empty($channels) ? new stdClass() : $channels,
            'a' => empty($aliases) ? new stdClass() : $aliases,
        ),
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
}

$cacheDir = epg_cache_dir();
$jsonFile = $cacheDir . '/epg_nownext.json';
$xmlFile = $cacheDir . '/epg_source.xml';
$lockFile = $cacheDir . '/epg_build.lock';
$now = time();

// php epg_api.php   o   epg_api.php?cron=1&key=...
// Así la guía está lista antes de que entre el primero.
$isCli = (php_sapi_name() === 'cli');
$cronKey = isset($_GET['key']) ? (string) $_GET['key'] : '';
if ($isCli && isset($argv[1])) {
    $cronKey = (string) $argv[1];
}
$forceRebuild = $isCli || (!empty($_GET['cron']) && $cronKey !== '' && hash_equals(player_cron_key(), $cronKey));
if (!empty($_GET['cron']) && !$forceRebuild) {
    http_response_code(403);
    echo json_encode(array('ok' => false, 'error' => 'clave cron incorrecta'));
    exit;
}

// epg_api.php?diag=1 — para ver desde el navegador por qué no hay guía.
if (isset($_GET['diag'])) {
    $diag = array(
        'php' => PHP_VERSION,
        'xmlreader' => class_exists('XMLReader'),
        'curl' => function_exists('curl_init'),
        'fuente' => defined('EPG_SOURCE') ? EPG_SOURCE : '(no definida)',
        'cache_dir' => $cacheDir,
        'cache_escribible' => is_writable($cacheDir),
        'xml_existe' => is_file($xmlFile),
        'xml_mb' => is_file($xmlFile) ? round(filesize($xmlFile) / 1048576, 1) : 0,
        'xml_edad_min' => is_file($xmlFile) ? round(($now - filemtime($xmlFile)) / 60) : null,
        'json_existe' => is_file($jsonFile),
        'json_kb' => is_file($jsonFile) ? round(filesize($jsonFile) / 1024) : 0,
        'json_edad_min' => is_file($jsonFile) ? round(($now - filemtime($jsonFile)) / 60) : null,
        'max_execution_time' => ini_get('max_execution_time'),
        'memory_limit' => ini_get('memory_limit'),
    );
    if (is_file($jsonFile)) {
        $peek = json_decode((string) @file_get_contents($jsonFile), true);
        $diag['json_canales'] = (is_array($peek) && isset($peek['c'])) ? count((array) $peek['c']) : 0;
    }
    echo json_encode($diag, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}

$jsonFresh = !$forceRebuild && is_file($jsonFile) && ($now - filemtime($jsonFile)) < EPG_JSON_TTL;
if ($jsonFresh && filesize($jsonFile) > 2) {
    readfile($jsonFile);
    exit;
}

// Solo una petición reconstruye la caché; el resto reciben la versión anterior
// para no encadenar varios parseos del XML a la vez.
$lock = @fopen($lockFile, 'c');
$gotLock = $lock && @flock($lock, LOCK_EX | LOCK_NB);

if (!$gotLock) {
    if (is_file($jsonFile) && filesize($jsonFile) > 2) {
        readfile($jsonFile);
    } else {
        echo epg_empty_payload();
    }
    if ($lock) {
        fclose($lock);
    }
    exit;
}

$xmlFresh = is_file($xmlFile) && ($now - filemtime($xmlFile)) < EPG_XML_TTL;
if (!$xmlFresh) {
    epg_download_xml($xmlFile);
}

$payload = is_file($xmlFile) ? epg_build_payload($xmlFile) : null;

if ($payload === null || $payload === false) {
    // Parseo fallido: mejor devolver la caché vieja que dejar al player sin guía.
    if (is_file($jsonFile) && filesize($jsonFile) > 2) {
        readfile($jsonFile);
    } else {
        echo epg_empty_payload();
    }
} else {
    @file_put_contents($jsonFile, $payload);
    echo $payload;
}

@flock($lock, LOCK_UN);
fclose($lock);
