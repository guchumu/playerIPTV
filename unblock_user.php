<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');
player_require_admin();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(array('success' => false, 'message' => 'Método no permitido'));
    exit;
}

$input = player_json_input();
$username = isset($input['username']) ? trim($input['username']) : '';
if ($username === '') {
    http_response_code(400);
    echo json_encode(array('success' => false, 'message' => 'Falta username'));
    exit;
}

try {
    $db = player_pdo();

    $stmt = $db->prepare('DELETE FROM blocked_users WHERE username = ?');
    $stmt->execute(array($username));

    try {
        $stmt = $db->prepare('UPDATE users SET active = 1 WHERE username = ?');
        $stmt->execute(array($username));
    } catch (PDOException $e) {
        // Tabla users opcional
    }

    echo json_encode(array('success' => true, 'message' => 'Usuario desbloqueado correctamente'));
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(array('success' => false, 'message' => 'Error DB'));
}
