<?php
// upload.php - Portal de carga remota
$mensaje = '';

// El QR de la pantalla de inicio trae el Device ID en la URL para no tener que
// copiarlo a mano desde la tele, que es la parte más incómoda del proceso.
$idPrevio = isset($_GET['id']) ? strtoupper(trim($_GET['id'])) : '';
if (!preg_match('/^[A-Z0-9-]{4,16}$/', $idPrevio)) {
    $idPrevio = '';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $deviceId = strtoupper(trim(isset($_POST['device_id']) ? $_POST['device_id'] : ''));
    $data = array(
        'serverUrl' => isset($_POST['serverUrl']) ? $_POST['serverUrl'] : '',
        'username' => isset($_POST['username']) ? $_POST['username'] : '',
        'password' => isset($_POST['password']) ? $_POST['password'] : '',
        'm3uUrl' => isset($_POST['m3uUrl']) ? $_POST['m3uUrl'] : '',
    );

    if (!is_dir(__DIR__ . '/cuentas')) {
        mkdir(__DIR__ . '/cuentas', 0777, true);
    }

    if ($deviceId !== '' && preg_match('/^[A-Z0-9-]{4,16}$/', $deviceId)) {
        file_put_contents(__DIR__ . '/cuentas/' . $deviceId . '.json', json_encode($data));
        $mensaje = 'Lista enviada con éxito a la TV (' . htmlspecialchars($deviceId, ENT_QUOTES, 'UTF-8') . '). Aparecerá en unos segundos.';
    } else {
        $mensaje = 'Error: Debes introducir un Device ID válido.';
    }
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cargar Lista - StreamBox IPTV</title>
    <style>
        body { background: #020617; color: white; font-family: system-ui, sans-serif; display: flex; justify-content: center; padding: 2rem; }
        .container { background: #0f172a; padding: 2rem; border-radius: 12px; width: 100%; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        h2 { text-align: center; color: #6366f1; margin-top: 0; }
        label { font-size: 0.8rem; font-weight: bold; color: #94a3b8; display: block; margin-top: 15px; margin-bottom: 5px; }
        input { width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: white; box-sizing: border-box; }
        button { width: 100%; padding: 12px; margin-top: 20px; background: #4f46e5; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
        .msg { margin-bottom: 15px; padding: 10px; border-radius: 6px; background: rgba(34, 197, 94, 0.2); color: #4ade80; text-align: center; font-size: 0.9rem; }
        .divider { text-align: center; margin: 20px 0; color: #475569; font-size: 0.8rem; }
        .ok-id { margin: 6px 0 0; font-size: 0.75rem; color: #4ade80; }
    </style>
</head>
<body>
    <div class="container">
        <h2>Subir Lista a TV</h2>
        <?php if ($mensaje): ?><div class="msg"><?php echo $mensaje; ?></div><?php endif; ?>
        <form method="POST">
            <label>Device ID (Aparece en la pantalla de la TV)</label>
            <input type="text" name="device_id" placeholder="Ej: A1-B2-C3" required autocomplete="off"
                   value="<?php echo htmlspecialchars($idPrevio, ENT_QUOTES, 'UTF-8'); ?>"><?php if ($idPrevio !== ''): ?>
            <p class="ok-id">Dispositivo detectado por QR</p><?php endif; ?>

            <label>Servidor Xtream Codes</label>
            <input type="text" name="serverUrl" placeholder="http://servidor.com:8080">
            <label>Usuario</label>
            <input type="text" name="username">
            <label>Contraseña</label>
            <input type="password" name="password">

            <div class="divider">— O SI TIENES LISTA M3U —</div>

            <label>Enlace M3U Directo</label>
            <input type="text" name="m3uUrl" placeholder="http://...">

            <button type="submit">Enviar al Dispositivo</button>
        </form>
    </div>
</body>
</html>
