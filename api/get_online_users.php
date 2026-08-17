<?php
require_once dirname(__DIR__) . '/config.php';
header('Content-Type: application/json; charset=utf-8');
player_require_admin();

try {
    $pdo = player_pdo();
    $stmt = $pdo->query("
        SELECT username, is_playing, current_channel, last_activity
        FROM users
        WHERE last_activity > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
        ORDER BY last_activity DESC
    ");
    $online_users = $stmt->fetchAll();
    echo json_encode(array(
        'success' => true,
        'online_count' => count($online_users),
        'users' => $online_users,
    ));
} catch (PDOException $e) {
    echo json_encode(array('success' => false));
}
