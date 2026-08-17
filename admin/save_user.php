<?php
session_start();
require_once '../api/db.php';

if (!isset($_SESSION['admin_logged_in'])) {
    header('Location: login.php');
    exit;
}

$user_id = $_POST['user_id'] ?? null;
$username = $_POST['username'] ?? '';
$password = $_POST['password'] ?? '';
$email = $_POST['email'] ?? null;
$xtream_username = $_POST['xtream_username'] ?? '';
$xtream_password = $_POST['xtream_password'] ?? '';
$expiration_date = $_POST['expiration_date'] ?? null;
$max_connections = $_POST['max_connections'] ?? 1;
$active = isset($_POST['active']) ? 1 : 0;

try {
    if ($user_id) {
        // EDITAR usuario existente
        $sql = "UPDATE users SET 
                username = ?, 
                email = ?, 
                xtream_username = ?, 
                xtream_password = ?, 
                expiration_date = ?, 
                max_connections = ?, 
                active = ?";
        
        $params = [$username, $email, $xtream_username, $xtream_password, $expiration_date, $max_connections, $active];
        
        // Solo actualizar contraseña si se proporcionó
        if (!empty($password)) {
            $sql .= ", password = ?";
            $params[] = password_hash($password, PASSWORD_DEFAULT);
        }
        
        $sql .= " WHERE id = ?";
        $params[] = $user_id;
        
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        
        header('Location: index.php?msg=updated');
    } else {
        // CREAR nuevo usuario
        if (empty($password)) {
            header('Location: index.php?error=password_required');
            exit;
        }
        
        $stmt = $pdo->prepare("INSERT INTO users 
            (username, password, email, xtream_username, xtream_password, expiration_date, max_connections, active) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        
        $stmt->execute([
            $username,
            password_hash($password, PASSWORD_DEFAULT),
            $email,
            $xtream_username,
            $xtream_password,
            $expiration_date,
            $max_connections,
            $active
        ]);
        
        header('Location: index.php?msg=created');
    }
} catch (PDOException $e) {
    header('Location: index.php?error=' . urlencode($e->getMessage()));
}
?>
