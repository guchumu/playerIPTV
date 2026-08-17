<?php
session_start();
require_once dirname(__DIR__) . '/config.php';

if (isset($_SESSION['admin_logged_in'])) {
    header('Location: index.php');
    exit;
}

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = isset($_POST['username']) ? trim($_POST['username']) : '';
    $password = isset($_POST['password']) ? $_POST['password'] : '';
    $hash = hash('sha256', $password);

    if (hash_equals(ADMIN_USER, $username) && hash_equals(ADMIN_PASS_SHA256, $hash)) {
        $_SESSION['admin_logged_in'] = true;
        $_SESSION['admin_username'] = ADMIN_USER;
        header('Location: index.php');
        exit;
    }
    $error = 'Usuario o contraseña incorrectos';
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin - StreamBox IPTV</title>
    <link rel="stylesheet" href="admin_style.css">
</head>
<body class="login-page">
    <div class="login-container">
        <h1>Panel de Administración</h1>
        <h2>StreamBox IPTV</h2>
        <form method="POST">
            <input type="text" name="username" placeholder="Usuario" required>
            <input type="password" name="password" placeholder="Contraseña" required>
            <button type="submit">Entrar</button>
            <?php if ($error): ?>
                <p class="error"><?php echo htmlspecialchars($error); ?></p>
            <?php endif; ?>
        </form>
    </div>
</body>
</html>
