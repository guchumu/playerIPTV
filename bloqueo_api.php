<?php
/**
 * Estado de bloqueo DNS/ISP para el player. Lee dns_check_domains.txt.
 */
require_once __DIR__ . '/dns_lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');

$force = !empty($_GET['force']) || !empty($_GET['fresh']) || !empty($_GET['nocache']);
if ($force && function_exists('player_rate_limit') && !player_rate_limit('bloqueo', 20, 60)) {
    http_response_code(429);
    echo json_encode(array('ok' => false, 'error' => 'Demasiadas comprobaciones. Espera un momento.'));
    exit;
}

$report = dns_build_report($force);
echo json_encode($report);
