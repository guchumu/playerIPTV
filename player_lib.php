<?php
/**
 * Utilidades compartidas por los PHP del player: caché, firma HMAC, límite
 * por IP y registro de errores. stream.php y xtream_proxy.php eran proxies
 * abiertos; de aquí sale el cierre mínimo para que no reenvíen tráfico ajeno
 * a costa del servidor.
 */
require_once __DIR__ . '/config.php';

function player_cache_dir()
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

function player_sign_secret()
{
    if (defined('STREAM_SIGN_SECRET') && STREAM_SIGN_SECRET !== '') {
        return STREAM_SIGN_SECRET;
    }
    $file = player_cache_dir() . '/stream_secret.txt';
    if (is_file($file)) {
        $stored = trim((string) @file_get_contents($file));
        if ($stored !== '') {
            return $stored;
        }
    }
    $secret = bin2hex(random_bytes(32));
    @file_put_contents($file, $secret, LOCK_EX);
    return $secret;
}

function player_mask($value)
{
    $value = (string) $value;
    $value = preg_replace('#([?&](?:username|password|user|pass)=)[^&]*#i', '$1***', $value);
    $value = preg_replace('#/(live|movie|series|play|stream|timeshift)/[^/]+/[^/]+/#i', '/$1/***/***/', $value);
    $value = preg_replace('#https?://[^/\s]+#i', '[origen]', $value);
    return $value;
}

function player_client_ip()
{
    $ip = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '0.0.0.0';
    return preg_replace('/[^0-9a-fA-F:.]/', '', $ip) ?: '0.0.0.0';
}

function player_log($message)
{
    $file = player_cache_dir() . '/proxy.log';
    if (is_file($file) && filesize($file) > 2097152) {
        @rename($file, $file . '.1');
    }
    $line = date('c') . ' ' . player_client_ip() . ' ' . player_mask($message) . "\n";
    @file_put_contents($file, $line, FILE_APPEND | LOCK_EX);
}

/**
 * Tope simple por IP. $max peticiones en $window segundos para un cubo.
 * Devuelve true si la petición entra.
 */
function player_rate_limit($bucket, $max, $window)
{
    $key = md5($bucket . '|' . player_client_ip());
    $file = player_cache_dir() . '/rl_' . $key . '.json';
    $now = time();
    $data = array('t' => $now, 'n' => 0);
    $fp = @fopen($file, 'c+');
    if (!$fp) {
        return true;
    }
    flock($fp, LOCK_EX);
    $raw = stream_get_contents($fp);
    if ($raw) {
        $parsed = json_decode($raw, true);
        if (is_array($parsed) && isset($parsed['t'], $parsed['n'])) {
            $data = $parsed;
        }
    }
    if ($now - (int) $data['t'] >= $window) {
        $data = array('t' => $now, 'n' => 0);
    }
    $data['n'] = (int) $data['n'] + 1;
    $ok = $data['n'] <= $max;
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($data));
    flock($fp, LOCK_UN);
    fclose($fp);
    if (!$ok) {
        player_log('rate-limit ' . $bucket . ' n=' . $data['n']);
    }
    return $ok;
}

function player_url_ok($url)
{
    $parts = parse_url($url);
    $scheme = isset($parts['scheme']) ? strtolower($parts['scheme']) : '';
    if (!$parts || empty($parts['host']) || !in_array($scheme, array('http', 'https'), true)) {
        return false;
    }
    $host = strtolower($parts['host']);
    $ip = filter_var($host, FILTER_VALIDATE_IP) ? $host : gethostbyname($host);
    $privado = filter_var($ip, FILTER_VALIDATE_IP)
        && !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
    if ($host === 'localhost' || $privado) {
        return false;
    }
    return true;
}

function player_sign_stream($url, $ttl = 14400)
{
    $exp = time() + (int) $ttl;
    $payload = $url . '|' . $exp;
    $sig = hash_hmac('sha256', $payload, player_sign_secret());
    return array('url' => $url, 'exp' => $exp, 'sig' => $sig);
}

function player_verify_stream($url, $exp, $sig)
{
    $exp = (int) $exp;
    if ($exp < time() || $exp > time() + 86400) {
        return false;
    }
    $payload = $url . '|' . $exp;
    $esperado = hash_hmac('sha256', $payload, player_sign_secret());
    return hash_equals($esperado, (string) $sig);
}

function player_cache_get($name, $ttl)
{
    $file = player_cache_dir() . '/' . $name;
    if (!is_file($file)) {
        return null;
    }
    if (time() - filemtime($file) > $ttl) {
        return null;
    }
    $raw = @file_get_contents($file);
    return ($raw === false || $raw === '') ? null : $raw;
}

function player_cache_set($name, $body)
{
    $file = player_cache_dir() . '/' . $name;
    @file_put_contents($file, $body, LOCK_EX);
}

function player_cron_key()
{
    if (defined('EPG_CRON_KEY') && EPG_CRON_KEY !== '') {
        return EPG_CRON_KEY;
    }
    $file = player_cache_dir() . '/cron_key.txt';
    if (is_file($file)) {
        $stored = trim((string) @file_get_contents($file));
        if ($stored !== '') {
            return $stored;
        }
    }
    $key = bin2hex(random_bytes(16));
    @file_put_contents($file, $key, LOCK_EX);
    return $key;
}
