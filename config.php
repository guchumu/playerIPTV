<?php
/**
 * StreamBox IPTV — configuración.
 *
 * Las claves reales van en config.local.php (no se versiona). Este archivo
 * solo pone valores por defecto para que el player arranque.
 */
if (is_file(__DIR__ . '/config.local.php')) {
    require_once __DIR__ . '/config.local.php';
}

if (!defined('DB_HOST')) {
    define('DB_HOST', 'localhost');
}
if (!defined('DB_USER')) {
    define('DB_USER', 'iptv_player');
}
if (!defined('DB_PASS')) {
    define('DB_PASS', 'contrasena');
}
if (!defined('DB_NAME')) {
    define('DB_NAME', 'iptv_player');
}

if (!defined('XTREAM_SERVER')) {
    define('XTREAM_SERVER', 'http://masquecero.net');
}

if (!defined('ADMIN_USER')) {
    define('ADMIN_USER', 'admin');
}
if (!defined('ADMIN_PASS_SHA256')) {
    define('ADMIN_PASS_SHA256', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9');
}
if (!defined('ADS_UPLOAD_KEY')) {
    define('ADS_UPLOAD_KEY', '');
}

if (!defined('EPG_SOURCE')) {
    define('EPG_SOURCE', 'https://raw.githubusercontent.com/davidmuma/EPG_dobleM/master/guiatv.xml');
}
if (!defined('EPG_CACHE_TTL')) {
    define('EPG_CACHE_TTL', 3600);
}

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
