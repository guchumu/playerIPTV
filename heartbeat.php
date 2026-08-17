<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(array('valid' => false, 'message' => 'Método no permitido'));
    exit;
}

$input = player_json_input();
$username = isset($input['username']) ? trim($input['username']) : '';
if ($username === '') {
    echo json_encode(array('valid' => false, 'message' => 'Datos inválidos'));
    exit;
}

$isPlaying = !empty($input['is_playing']);
$channel = isset($input['current_channel']) ? $input['current_channel'] : null;

try {
    $db = player_pdo();

    $blocked = false;
    try {
        $stmt = $db->prepare('SELECT username FROM blocked_users WHERE username = ?');
        $stmt->execute(array($username));
        $blocked = (bool) $stmt->fetch();
    } catch (PDOException $e) {
        $blocked = false;
    }

    if ($blocked) {
        echo json_encode(array(
            'valid' => false,
            'blocked' => true,
            'message' => 'Usuario bloqueado',
        ));
        exit;
    }

    $forceStop = false;
    try {
        $stmt = $db->prepare('SELECT force_stop FROM user_activity WHERE username = ? AND is_active = 1');
        $stmt->execute(array($username));
        $row = $stmt->fetch();
        if ($row && !empty($row['force_stop'])) {
            $forceStop = true;
            $clear = $db->prepare('UPDATE user_activity SET force_stop = 0, is_active = 0 WHERE username = ?');
            $clear->execute(array($username));
        } elseif ($isPlaying && $channel) {
            $stmt = $db->prepare('UPDATE user_activity SET last_update = NOW() WHERE username = ? AND is_active = 1');
            $stmt->execute(array($username));
        }
    } catch (PDOException $e) {
        // Tabla aún no creada: el reproductor sigue.
    }

    echo json_encode(array(
        'valid' => true,
        'stop_playback' => $forceStop,
        'message' => 'OK',
    ));
} catch (PDOException $e) {
    error_log('HEARTBEAT ERROR: ' . $e->getMessage());
    echo json_encode(array('valid' => true, 'message' => 'db_unavailable'));
}
