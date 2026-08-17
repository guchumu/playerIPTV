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
    echo json_encode(array('success' => false, 'message' => 'Usuario no especificado'));
    exit;
}

try {
    $db = player_pdo();
    $stmt = $db->prepare('UPDATE user_activity SET force_stop = 1 WHERE username = ?');
    $stmt->execute(array($username));
    echo json_encode(array('success' => true, 'message' => 'Señal de detención enviada', 'username' => $username));
} catch (PDOException $e) {
    echo json_encode(array('success' => false, 'message' => 'Error DB'));
}
