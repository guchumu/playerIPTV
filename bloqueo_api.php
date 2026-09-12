<?php
require_once __DIR__ . '/dns_lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$force = isset($_GET['force']) && $_GET['force'] === '1';
$report = dns_build_report($force);
echo json_encode($report);
