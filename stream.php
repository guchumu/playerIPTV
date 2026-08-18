<?php
// stream.php - Relé de vídeo en directo (player.zip)
//
// Dos modos:
//   ?url=...&exp=...&sig=...           relé continuo
//   ?url=...&exp=...&sig=...&probe=1   diagnóstico JSON
//
// url sola ya no basta: hacía de proxy abierto.

require_once __DIR__ . '/player_lib.php';

set_time_limit(0);
ignore_user_abort(false);

while (ob_get_level() > 0) {
    @ob_end_clean();
}

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Range');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

const STREAM_USER_AGENT = 'VLC/3.0.16 LibVLC/3.0.16';

$url = isset($_GET['url']) ? trim((string) $_GET['url']) : '';
$isProbe = !empty($_GET['probe']);
$exp = isset($_GET['exp']) ? (int) $_GET['exp'] : 0;
$sig = isset($_GET['sig']) ? (string) $_GET['sig'] : '';

/**
 * Corta la petición explicando el motivo en el formato que espera quien llama.
 */
function stream_fail(int $code, string $message, bool $isProbe): void
{
    http_response_code($code);
    if ($isProbe) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_UNICODE);
    } else {
        header('Content-Type: text/plain; charset=utf-8');
        echo $message;
    }
    exit;
}

if ($url === '') {
    stream_fail(400, 'Falta el parámetro url', $isProbe);
}

if (!player_rate_limit('stream', 20, 60)) {
    stream_fail(429, 'Demasiadas peticiones de stream', $isProbe);
}

if ($sig !== '') {
    if (!player_verify_stream($url, $exp, $sig)) {
        player_log('stream firma invalida');
        stream_fail(403, 'Firma inválida o caducada', $isProbe);
    }
} else {
    // Transición: el player publicado aún pide ?url= sin firma.
    // Cuando core.js + sign.php estén en el servidor, las peticiones
    // vendrán firmadas. Mientras tanto no se corta el directo.
    player_log('stream sin firma');
}

if (!player_url_ok($url)) {
    stream_fail(400, 'URL no válida', $isProbe);
}

$parts = parse_url($url);

$estado = 0;
$tipo = '';

/**
 * Cabeceras del origen. Con redirecciones se llama una vez por salto, así que
 * al final quedan los valores del destino real.
 */
$leerCabecera = function ($ch, $linea) use (&$estado, &$tipo) {
    if (preg_match('#^HTTP/\S+\s+(\d{3})#i', $linea, $m)) {
        $estado = (int) $m[1];
    }
    if (stripos($linea, 'content-type:') === 0) {
        $tipo = trim(substr($linea, 13));
    }
    return strlen($linea);
};

$comun = [
    CURLOPT_URL => $url,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_USERAGENT => STREAM_USER_AGENT,
    CURLOPT_HEADERFUNCTION => $leerCabecera,
];

/********** Modo diagnóstico **********/
if ($isProbe) {
    $muestra = '';
    $bytes = 0;

    $ch = curl_init();
    curl_setopt_array($ch, $comun + [
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 12,
        CURLOPT_WRITEFUNCTION => function ($ch, $trozo) use (&$muestra, &$bytes) {
            $bytes += strlen($trozo);
            if (strlen($muestra) < 400) {
                $muestra .= $trozo;
            }
            // Con 64 KB ya se sabe si el origen emite; seguir solo gastaría
            // ancho de banda y mantendría ocupada una conexión.
            return $bytes >= 65536 ? 0 : strlen($trozo);
        },
    ]);
    curl_exec($ch);
    $errno = curl_errno($ch);
    $error = curl_error($ch);
    curl_close($ch);

    // Cortar a propósito desde el callback devuelve CURLE_WRITE_ERROR (23).
    // Es la señal de éxito de este modo, no un fallo.
    $cortadoAdrede = ($errno === CURLE_WRITE_ERROR);
    $esTs = $muestra !== '' && $muestra[0] === "\x47";
    $pareceTexto = $muestra !== '' && !$esTs && mb_check_encoding($muestra, 'UTF-8');

    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => $bytes > 0 && $estado > 0 && $estado < 400,
        'status' => $estado,
        'type' => $tipo,
        'bytes' => $bytes,
        'ts' => $esTs,
        'sample' => $pareceTexto ? mb_substr(preg_replace('/\s+/u', ' ', $muestra), 0, 300) : '',
        'curl' => ($errno && !$cortadoAdrede) ? ($errno . ': ' . $error) : '',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

/********** Modo relé **********/
// La cabecera HTTP tiene que salir YA. Si PHP espera al primer byte del
// origen, nginx/php-fpm corta a los ~20s con 504 y mpegts.js ni siquiera
// llega a leer. Un 200 con el cuerpo aún vacío es recuperable; el 504 no.
header('Content-Type: video/mp2t');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('X-Accel-Buffering: no');
flush();

// Salida agrupada. Mandar un flush() por cada trozo de curl troceaba el
// directo y mpegts.js se desbordaba con "Maximum call stack size exceeded".
const RELE_BLOQUE = 65536;
const RELE_MS = 200;
$pendiente = '';
$ultimoEnvio = microtime(true);
$huboDatos = false;

$ch = curl_init();
curl_setopt_array($ch, $comun + [
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT => 0,
    CURLOPT_LOW_SPEED_LIMIT => 1,
    CURLOPT_LOW_SPEED_TIME => 45,
    CURLOPT_BUFFERSIZE => 65536,
    CURLOPT_WRITEFUNCTION => function ($ch, $trozo) use (&$estado, &$pendiente, &$ultimoEnvio, &$huboDatos) {
        if ($estado >= 400) {
            player_log('origen HTTP ' . $estado . ' tras haber enviado 200 al cliente');
            return 0;
        }
        $huboDatos = true;
        $pendiente .= $trozo;
        $ahora = microtime(true);
        if (strlen($pendiente) >= RELE_BLOQUE || ($ahora - $ultimoEnvio) * 1000 >= RELE_MS) {
            echo $pendiente;
            $pendiente = '';
            $ultimoEnvio = $ahora;
            flush();
            if (connection_aborted()) {
                return 0;
            }
        }
        return strlen($trozo);
    },
]);
curl_exec($ch);
$errno = curl_errno($ch);
curl_close($ch);

if ($pendiente !== '') {
    echo $pendiente;
    flush();
}

if (!$huboDatos) {
    player_log('rele sin datos' . ($errno ? ' curl ' . $errno : '') . ($estado ? ' origen ' . $estado : ''));
}
