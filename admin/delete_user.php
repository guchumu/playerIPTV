<?php
session_start();
require_once '../api/db.php';

if (!isset($_SESSION['admin_logged_in'])) {
    header('Location: login.php');
    exit;
}

$user_id = $_POST['user_id'] ?? null;

if ($user_id) {
    try {
        $stmt = $pdo->prepare("DELETE FROM users WHERE id = ?");
        $stmt->execute([$user_id]);
        header('Location: index.php?msg=deleted');
    } catch (PDOException $e) {
        header('Location: index.php?error=' . urlencode($e->getMessage()));
    }
} else {
    header('Location: index.php?error=invalid_id');
}
?>
