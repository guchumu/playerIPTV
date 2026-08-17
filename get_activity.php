<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');
player_require_admin();

try {
    $db = player_pdo();

    $stmt = $db->query("
        SELECT
            a.username,
            a.channel_name,
            a.channel_url,
            a.start_time,
            a.last_update,
            a.is_active,
            TIMESTAMPDIFF(SECOND, a.last_update, NOW()) AS seconds_ago,
            CASE WHEN b.username IS NULL THEN 0 ELSE 1 END AS blocked
        FROM user_activity a
        LEFT JOIN blocked_users b ON b.username = a.username
        WHERE a.is_active = 1
          AND a.last_update > DATE_SUB(NOW(), INTERVAL 2 MINUTE)
        ORDER BY a.last_update DESC
    ");
    $active = $stmt->fetchAll();

    echo json_encode(array(
        'success' => true,
        'active_users' => $active,
        'count' => count($active),
        'timestamp' => date('Y-m-d H:i:s'),
    ));
} catch (PDOException $e) {
    try {
        $db = player_pdo();
        $stmt = $db->query("
            SELECT username, channel_name, channel_url, start_time, last_update, is_active,
                   TIMESTAMPDIFF(SECOND, last_update, NOW()) AS seconds_ago,
                   0 AS blocked
            FROM user_activity
            WHERE is_active = 1
              AND last_update > DATE_SUB(NOW(), INTERVAL 2 MINUTE)
            ORDER BY last_update DESC
        ");
        $active = $stmt->fetchAll();
        echo json_encode(array(
            'success' => true,
            'active_users' => $active,
            'count' => count($active),
            'timestamp' => date('Y-m-d H:i:s'),
        ));
    } catch (PDOException $e2) {
        error_log('get_activity ERROR: ' . $e2->getMessage());
        echo json_encode(array('success' => false, 'error' => 'Error de base de datos'));
    }
}
