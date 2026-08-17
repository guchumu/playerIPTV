<?php
// stream.php - Relé de vídeo en directo (player.zip)
//
// Dos modos:
//   ?url=...           relé continuo del stream hacia la etiqueta <video>
//   ?url=...&probe=1   consulta corta que devuelve en JSON lo que contesta de
//                      verdad el proveedor: código, tipo y muestra del cuerpo
//
// El modo probe existe porque el relé está obligado a enviar su cabecera antes
// de saber qué va a responder el origen. Consultar el relé para diagnosticar
// devolvía siempre "200 video/mp2t" incluso cuando el proveedor no mandaba un
// solo byte, lo que hacía culpar al reproductor de fallos que eran del origen.

set_time_limit(0);
// Terminar en cuanto el navegador cierre: cada relé zombi retiene una de las
// conexiones simultáneas que el proveedor concede a la cuenta.
ignore_user_abort(false);

// Nada debe quedarse retenido en memoria: el directo tiene que salir a chorro.
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

$parts = parse_url($url);
$scheme = isset($parts['scheme']) ? strtolower($parts['scheme']) : '';
if (!$parts || $scheme === '' || empty($parts['host']) || !in_array($scheme, ['http', 'https'], true)) {
    stream_fail(400, 'URL no válida', $isProbe);
}

// Este script acepta cualquier destino, así que al menos no debe servir de
// puente para asomarse a la red interna de la máquina que lo aloja.
$host = strtolower($parts['host']);
$ip = filter_var($host, FILTER_VALIDATE_IP) ? $host : gethostbyname($host);
$privado = filter_var($ip, FILTER_VALIDATE_IP)
    && !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
if ($host === 'localhost' || $privado) {
    stream_fail(403, 'Destino no permitido', $isProbe);
}

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
$cabeceraEnviada = false;

$ch = curl_init();
curl_setopt_array($ch, $comun + [
    CURLOPT_CONNECTTIMEOUT => 12,
    // El directo no termina, así que no puede haber límite total. Lo que sí
    // hace falta es matar la fuente que deja de emitir: sin esto un origen
    // colgado retiene para siempre un proceso PHP y una conexión del proveedor.
    CURLOPT_TIMEOUT => 0,
    CURLOPT_LOW_SPEED_LIMIT => 512,
    CURLOPT_LOW_SPEED_TIME => 20,
    CURLOPT_BUFFERSIZE => 32768,
    CURLOPT_WRITEFUNCTION => function ($ch, $trozo) use (&$cabeceraEnviada, &$estado, &$tipo) {
        if (!$cabeceraEnviada) {
            $cabeceraEnviada = true;
            if ($estado >= 400) {
                http_response_code($estado);
                header('Content-Type: text/plain; charset=utf-8');
                echo 'El proveedor respondió ' . $estado;
                return 0;
            }
            header('Content-Type: ' . ($tipo !== '' ? $tipo : 'video/mp2t'));
            header('Cache-Control: no-cache, no-store, must-revalidate');
            // Impide que nginx acumule el directo antes de entregarlo, que es
            // lo que provoca que llegue a ráfagas en lugar de continuo.
            header('X-Accel-Buffering: no');
        }
        echo $trozo;
        flush();
        if (connection_aborted()) {
            return 0;
        }
        return strlen($trozo);
    },
]);
curl_exec($ch);
$errno = curl_errno($ch);
curl_close($ch);

if (!$cabeceraEnviada) {
    // No llegó ni un byte: el fallo es del origen y hay que decirlo con un
    // código de error, no con un 200 vacío que el reproductor no sabe leer.
    http_response_code($estado >= 400 ? $estado : 504);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Sin datos del proveedor' . ($errno ? ' (curl ' . $errno . ')' : '');
}
