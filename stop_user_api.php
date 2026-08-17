<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');
player_require_admin();

$input = player_json_input();
$username = isset($input['username']) ? trim($input['username']) : '';
if ($username === '') {
    echo json_encode(array('success' => false, 'message' => 'Usuario no especificado'));
    exit;
}

try {
    $db = player_pdo();
    $stmt = $db->prepare('UPDATE user_activity SET is_active = 0, force_stop = 1 WHERE username = ?');
    $stmt->execute(array($username));
    echo json_encode(array('success' => true, 'message' => 'Usuario detenido'));
} catch (PDOException $e) {
    echo json_encode(array('success' => false, 'message' => 'Error DB'));
}
