<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once 'db.php';

$input = file_get_contents('php://input');
$data = json_decode($input, true);

$username = isset($data['username']) ? trim($data['username']) : '';
$password = isset($data['password']) ? trim($data['password']) : '';

if (empty($username) || empty($password)) {
    echo json_encode(['success' => false, 'message' => 'Faltan datos']);
    exit;
}

try {
    // Buscar usuario en la base de datos
    $stmt = $pdo->prepare("SELECT * FROM users WHERE username = ? AND active = 1");
    $stmt->execute([$username]);
    $user = $stmt->fetch();
    
    if (!$user) {
        echo json_encode(['success' => false, 'message' => 'Usuario no encontrado o inactivo']);
        exit;
    }
    
    // Verificar contraseña
    if (!password_verify($password, $user['password'])) {
        echo json_encode(['success' => false, 'message' => 'Contraseña incorrecta']);
        exit;
    }
    
    // Verificar si ha caducado (fecha de BD)
    if ($user['expiration_date'] && strtotime($user['expiration_date']) < time()) {
        echo json_encode(['success' => false, 'message' => 'Tu cuenta ha expirado']);
        exit;
    }
    
    // Valores por defecto desde BD
    $xtream_expiry = $user['expiration_date'];
    $max_connections = intval($user['max_connections'] ?? 1);
    $active_connections = 0;
    
    // Obtener información actualizada de Xtream Codes
    if (!empty($user['xtream_username']) && !empty($user['xtream_password'])) {
        $xtream_info_url = "http://masquecero.net/player_api.php?username=" 
            . urlencode($user['xtream_username']) 
            . "&password=" . urlencode($user['xtream_password']);
        
        $xtream_info = @file_get_contents($xtream_info_url);
        
        if ($xtream_info !== false) {
            $xtream_data = json_decode($xtream_info, true);
            
            if (isset($xtream_data['user_info']) && $xtream_data['user_info']['auth'] == 1) {
                $user_info = $xtream_data['user_info'];
                
                // Convertir timestamp a fecha
                if (isset($user_info['exp_date'])) {
                    $xtream_expiry = date('Y-m-d H:i:s', intval($user_info['exp_date']));
                }
                
                // Convertir strings a enteros (Xtream devuelve strings)
                if (isset($user_info['max_connections'])) {
                    $max_connections = intval($user_info['max_connections']);
                }
                
                if (isset($user_info['active_cons'])) {
                    $active_connections = intval($user_info['active_cons']);
                }
                
                // Actualizar en BD con datos frescos de Xtream
                $stmt = $pdo->prepare("UPDATE users SET expiration_date = ?, max_connections = ? WHERE id = ?");
                $stmt->execute([$xtream_expiry, $max_connections, $user['id']]);
            }
        }
    }
    
    // Generar token de sesión
    $token = bin2hex(random_bytes(32));
    
    // Guardar token y último login en BD
    $stmt = $pdo->prepare("UPDATE users SET session_token = ?, last_login = NOW() WHERE id = ?");
    $stmt->execute([$token, $user['id']]);
    
    // Guardar sesión en archivo temporal
    $session_dir = '/tmp/player_sessions/';
    if (!is_dir($session_dir)) {
        mkdir($session_dir, 0755, true);
    }
    
    $session_data = [
        'user_id' => $user['id'],
        'username' => $username,
        'xtream_username' => $user['xtream_username'] ?? null,
        'xtream_password' => $user['xtream_password'] ?? null,
        'created' => time(),
        'last_activity' => time(),
        'expiry_date' => $xtream_expiry,
        'max_connections' => $max_connections,
        'active_connections' => $active_connections
    ];
    
    file_put_contents($session_dir . $token . '.json', json_encode($session_data));
    
    // Respuesta exitosa
    echo json_encode([
        'success' => true,
        'token' => $token,
        'username' => $username,
        'expiry_date' => $xtream_expiry,
        'max_connections' => $max_connections,
        'active_connections' => $active_connections
    ]);
    
} catch (PDOException $e) {
    error_log("Error en login.php: " . $e->getMessage());
    echo json_encode([
        'success' => false, 
        'message' => 'Error del servidor'
    ]);
}
?>
