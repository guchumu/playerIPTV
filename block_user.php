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

    if ($username === 'ALL') {
        $db->exec('INSERT IGNORE INTO blocked_users (username) SELECT DISTINCT username FROM user_activity WHERE is_active = 1');
        $db->exec('UPDATE user_activity SET is_active = 0, force_stop = 1');
        echo json_encode(array('success' => true, 'message' => 'Todos los usuarios online han sido bloqueados'));
        exit;
    }

    $stmt = $db->prepare('INSERT INTO blocked_users (username) VALUES (?) ON DUPLICATE KEY UPDATE blocked_at = NOW()');
    $stmt->execute(array($username));

    $stmt = $db->prepare('UPDATE user_activity SET is_active = 0, force_stop = 1 WHERE username = ?');
    $stmt->execute(array($username));

    try {
        $stmt = $db->prepare('UPDATE users SET active = 0 WHERE username = ?');
        $stmt->execute(array($username));
    } catch (PDOException $e) {
        // Tabla users opcional
    }

    echo json_encode(array('success' => true, 'message' => 'Usuario bloqueado correctamente'));
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(array('success' => false, 'message' => 'Error DB'));
}
