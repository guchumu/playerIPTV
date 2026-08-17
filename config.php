<?php
/**
 * StreamBox IPTV — configuración única.
 * El resto de PHP debe incluir este archivo.
 */

define('DB_HOST', 'localhost');
define('DB_USER', 'iptv_player');
define('DB_PASS', 'contrasena');
define('DB_NAME', 'iptv_player');

define('XTREAM_SERVER', 'http://masquecero.net');

define('ADMIN_USER', 'admin');
// SHA-256 de la contraseña de admin. Cámbiala y actualiza el hash.
define('ADMIN_PASS_SHA256', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9');

define('EPG_SOURCE', 'https://raw.githubusercontent.com/davidmuma/EPG_dobleM/master/guiatv.xml');
define('EPG_CACHE_TTL', 3600);

function player_allowed_hosts()
{
    $hosts = array('masquecero.net', 'lunasea.mooo.com');
    $parsed = parse_url(XTREAM_SERVER);
    if (!empty($parsed['host'])) {
        $hosts[] = strtolower($parsed['host']);
    }
    return array_values(array_unique($hosts));
}

function player_host_allowed($url)
{
    $host = strtolower((string) parse_url($url, PHP_URL_HOST));
    if ($host === '') {
        return false;
    }
    foreach (player_allowed_hosts() as $allowed) {
        $allowed = strtolower($allowed);
        if ($host === $allowed) {
            return true;
        }
        $suffix = '.' . $allowed;
        if (substr($host, -strlen($suffix)) === $suffix) {
            return true;
        }
    }
    return false;
}

function player_pdo()
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER,
        DB_PASS
    );
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    return $pdo;
}

function player_json_input()
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : array();
}

function player_require_admin()
{
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
    if (empty($_SESSION['admin_logged_in'])) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(array('success' => false, 'message' => 'No autorizado'));
        exit;
    }
}
