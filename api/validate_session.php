<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

require_once 'db.php';

$input = file_get_contents('php://input');
$data = json_decode($input, true);
$token = isset($data['token']) ? $data['token'] : '';

if (empty($token)) {
    echo json_encode(['valid' => false]);
    exit;
}

try {
    // Buscar sesión en BD
    $stmt = $pdo->prepare("SELECT * FROM users WHERE session_token = ? AND active = 1");
    $stmt->execute([$token]);
    $user = $stmt->fetch();
    
    if (!$user) {
        echo json_encode(['valid' => false]);
        exit;
    }
    
    // Verificar caducidad
    if ($user['expiration_date'] && strtotime($user['expiration_date']) < time()) {
        echo json_encode(['valid' => false, 'message' => 'Cuenta expirada']);
        exit;
    }
    
    // Actualizar última actividad
    $stmt = $pdo->prepare("UPDATE users SET last_activity = NOW() WHERE id = ?");
    $stmt->execute([$user['id']]);
    
    // Obtener info actualizada de Xtream
    $max_connections = intval($user['max_connections'] ?? 1);
    $active_connections = 0;
    
    if (!empty($user['xtream_username']) && !empty($user['xtream_password'])) {
        $xtream_info_url = "http://masquecero.net/player_api.php?username=" 
            . urlencode($user['xtream_username']) 
            . "&password=" . urlencode($user['xtream_password']);
        
        $xtream_info = @file_get_contents($xtream_info_url);
        
        if ($xtream_info !== false) {
            $xtream_data = json_decode($xtream_info, true);
            
            if (isset($xtream_data['user_info']) && $xtream_data['user_info']['auth'] == 1) {
                // Convertir strings a enteros
                $max_connections = intval($xtream_data['user_info']['max_connections']);
                $active_connections = intval($xtream_data['user_info']['active_cons']);
            }
        }
    }
    
    echo json_encode([
        'valid' => true,
        'expiry_date' => $user['expiration_date'],
        'max_connections' => $max_connections,
        'active_connections' => $active_connections
    ]);
    
} catch (PDOException $e) {
    echo json_encode(['valid' => false, 'message' => 'Error: ' . $e->getMessage()]);
}
?>
