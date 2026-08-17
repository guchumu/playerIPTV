<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

require_once 'db.php';

$data = json_decode(file_get_contents('php://input'), true);
$token = $data['token'] ?? '';
$username = $data['username'] ?? '';
$is_playing = $data['is_playing'] ?? false;
$current_channel = $data['current_channel'] ?? '';

try {
    $stmt = $pdo->prepare("SELECT * FROM users WHERE username = ? AND session_token = ? AND active = 1");
    $stmt->execute([$username, $token]);
    $user = $stmt->fetch();
    
    if (!$user) {
        echo json_encode(['valid' => false]);
        exit;
    }
    
    // Verificar expiración
    if (strtotime($user['expiration_date']) < time()) {
        $stmt = $pdo->prepare("UPDATE users SET active = 0 WHERE id = ?");
        $stmt->execute([$user['id']]);
        echo json_encode(['valid' => false, 'account_suspended' => true]);
        exit;
    }
    
    // Actualizar estado de reproducción
    $stmt = $pdo->prepare("
        UPDATE users 
        SET last_activity = NOW(), 
            is_playing = ?, 
            current_channel = ? 
        WHERE id = ?
    ");
    $stmt->execute([$is_playing ? 1 : 0, $current_channel, $user['id']]);
    
    // CONTROL DE REPRODUCCIÓN ÚNICA: Verificar si hay otra sesión activa
    if ($is_playing) {
        $stmt = $pdo->prepare("
            SELECT COUNT(*) as count 
            FROM users 
            WHERE username = ? 
            AND is_playing = 1 
            AND last_activity > DATE_SUB(NOW(), INTERVAL 30 SECOND)
            AND session_token != ?
        ");
        $stmt->execute([$username, $token]);
        $result = $stmt->fetch();
        
        if ($result['count'] > 0) {
            // Hay otra sesión reproduciendo
            echo json_encode(['valid' => false, 'message' => 'Reproducción desde otro dispositivo detectada']);
            exit;
        }
    }
    
    echo json_encode(['valid' => true]);
    
} catch (PDOException $e) {
    echo json_encode(['valid' => false]);
}
