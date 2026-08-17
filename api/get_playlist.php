<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
require_once 'db.php';

$data = json_decode(file_get_contents('php://input'), true);
$token = $data['token'] ?? '';
$username = $data['username'] ?? '';

$stmt = $pdo->prepare("SELECT * FROM users WHERE username = ? AND session_token = ? AND active = 1");
$stmt->execute([$username, $token]);
$user = $stmt->fetch();

if (!$user) {
    echo json_encode(['success' => false, 'message' => 'Sesión inválida']);
    exit;
}

// VINCULACIÓN CON TU XTREAM
$xtream_user = $user['xtream_username'];
$xtream_pass = $user['xtream_password'];

// Generar URL de tu get.php
$playlist_url = "http://masquecero.net/get.php?username={$xtream_user}&password={$xtream_pass}&type=m3u";

// Obtener la lista
$playlist_content = file_get_contents($playlist_url);

echo json_encode([
    'success' => true,
    'playlist' => $playlist_content
]);
?>
