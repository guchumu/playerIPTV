<?php
require_once dirname(__DIR__) . '/config.php';

try {
    $pdo = player_pdo();
} catch (PDOException $e) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('success' => false, 'message' => 'Error de conexión'));
    exit;
}
