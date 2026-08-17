<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(array('success' => false, 'message' => 'Método no permitido'));
    exit;
}

$input = player_json_input();
$username = isset($input['username']) ? trim($input['username']) : '';
$action = isset($input['action']) ? $input['action'] : 'update';

if ($username === '') {
    http_response_code(400);
    echo json_encode(array('success' => false, 'message' => 'Datos incompletos'));
    exit;
}

try {
    $db = player_pdo();

    if ($action === 'stop') {
        $stmt = $db->prepare('UPDATE user_activity SET is_active = 0, last_update = NOW() WHERE username = ?');
        $stmt->execute(array($username));
        echo json_encode(array('success' => true, 'action' => 'STOPPED'));
        exit;
    }

    $channelName = isset($input['channel']) ? $input['channel'] : '';
    $channelUrl = isset($input['url']) ? $input['url'] : '';

    $stmt = $db->prepare('SELECT id FROM user_activity WHERE username = ? LIMIT 1');
    $stmt->execute(array($username));
    $existing = $stmt->fetch();

    if ($existing) {
        $stmt = $db->prepare('
            UPDATE user_activity
            SET channel_name = ?, channel_url = ?, last_update = NOW(), is_active = 1, force_stop = 0
            WHERE id = ?
        ');
        $stmt->execute(array($channelName, $channelUrl, $existing['id']));
        $actionName = 'UPDATED';
    } else {
        $stmt = $db->prepare('
            INSERT INTO user_activity (username, channel_name, channel_url, start_time, last_update, is_active, force_stop)
            VALUES (?, ?, ?, NOW(), NOW(), 1, 0)
        ');
        $stmt->execute(array($username, $channelName, $channelUrl));
        $actionName = 'CREATED';
    }

    echo json_encode(array('success' => true, 'action' => $actionName));
} catch (PDOException $e) {
    error_log('activity_api ERROR: ' . $e->getMessage());
    echo json_encode(array('success' => true, 'message' => 'db_unavailable'));
}
