<?php
// upload.php - Portal de carga remota
$mensaje = '';

function rs_format_device_id($raw) {
    $id = strtoupper(preg_replace('/[^A-Z0-9]/', '', (string) $raw));
    if (strlen($id) === 6) {
        return substr($id, 0, 2) . '-' . substr($id, 2, 2) . '-' . substr($id, 4, 2);
    }
    return strtoupper(trim((string) $raw));
}

// El QR de la pantalla de inicio trae el Device ID en la URL para no tener que
// copiarlo a mano desde la tele, que es la parte más incómoda del proceso.
$idPrevio = isset($_GET['id']) ? rs_format_device_id($_GET['id']) : '';
if (!preg_match('/^[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}$/', $idPrevio)) {
    $idPrevio = '';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $deviceId = rs_format_device_id(isset($_POST['device_id']) ? $_POST['device_id'] : '');
    $serverUrl = isset($_POST['serverUrl']) ? trim((string) $_POST['serverUrl']) : '';
    $username = isset($_POST['username']) ? trim((string) $_POST['username']) : '';
    $password = isset($_POST['password']) ? trim((string) $_POST['password']) : '';
    $m3uUrl = isset($_POST['m3uUrl']) ? trim((string) $_POST['m3uUrl']) : '';
    // Usuario+clave = Xtream (ignorar M3U residual del autocompletado).
    if ($username !== '' && $password !== '') {
        if ($serverUrl === '') {
            $serverUrl = 'http://masquecero.net';
        }
        $m3uUrl = '';
    } elseif ($m3uUrl !== '') {
        $username = '';
        $password = '';
    }
    $data = array(
        'serverUrl' => $serverUrl,
        'username' => $username,
        'password' => $password,
        'm3uUrl' => $m3uUrl,
        'listName' => isset($_POST['listName']) ? trim($_POST['listName']) : '',
        'ts' => (int) round(microtime(true) * 1000),
        'status' => 'listo',
    );

    if (!is_dir(__DIR__ . '/cuentas')) {
        mkdir(__DIR__ . '/cuentas', 0777, true);
    }

    if ($deviceId !== '' && preg_match('/^[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}$/', $deviceId)) {
        file_put_contents(__DIR__ . '/cuentas/' . $deviceId . '.json', json_encode($data));
        // Compatibilidad: borrar copia sin guiones si existía.
        $plain = str_replace('-', '', $deviceId);
        $plainFile = __DIR__ . '/cuentas/' . $plain . '.json';
        if (is_file($plainFile)) {
            @unlink($plainFile);
        }
        $mensaje = 'Lista enviada con éxito a la TV (' . htmlspecialchars($deviceId, ENT_QUOTES, 'UTF-8') . '). Aparecerá en unos segundos.';
    } else {
        $mensaje = 'Error: Debes introducir un Device ID válido (6 caracteres, ej. A1B2C3).';
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
        .device-id-input { letter-spacing: 0.12em; font-size: 1.15rem; font-weight: 700; text-transform: uppercase; }
    </style>
</head>
<body>
    <div class="container">
        <h2>Subir Lista a TV</h2>
        <?php if ($mensaje): ?><div class="msg"><?php echo $mensaje; ?></div><?php endif; ?>
        <form method="POST">
            <label>Device ID (Aparece en la pantalla de la TV)</label>
            <input type="text" id="deviceIdInput" class="device-id-input" name="device_id"
                   placeholder="A1B2C3" required autocomplete="off" inputmode="text"
                   maxlength="8"
                   value="<?php echo htmlspecialchars($idPrevio, ENT_QUOTES, 'UTF-8'); ?>"><?php if ($idPrevio !== ''): ?>
            <p class="ok-id">Dispositivo detectado por QR</p><?php endif; ?>

            <label>Nombre de la lista (opcional)</label>
            <input type="text" name="listName" placeholder="Ej: Casa, Trabajo, Proveedor X" maxlength="64">

            <label>Servidor Xtream Codes</label>
            <input type="text" name="serverUrl" placeholder="http://servidor.com:8080" autocomplete="off">
            <label>Usuario</label>
            <input type="text" name="username" autocomplete="username">
            <label>Contraseña</label>
            <input type="password" name="password" autocomplete="current-password">

            <div class="divider">— O SI TIENES LISTA M3U —</div>

            <label>Enlace M3U Directo</label>
            <input type="text" name="m3uUrl" placeholder="http://..." autocomplete="off">

            <button type="submit">Enviar al Dispositivo</button>
        </form>
    </div>
    <script>
      (function () {
        var input = document.getElementById("deviceIdInput");
        if (!input) return;

        function formatId(raw) {
          var clean = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
          if (clean.length <= 2) return clean;
          if (clean.length <= 4) return clean.slice(0, 2) + "-" + clean.slice(2);
          return clean.slice(0, 2) + "-" + clean.slice(2, 4) + "-" + clean.slice(4);
        }

        function applyFormat() {
          var start = input.selectionStart;
          var before = input.value;
          var next = formatId(before);
          if (next === before) return;
          // Contar cuántos caracteres "reales" había antes del cursor.
          var left = before.slice(0, start).toUpperCase().replace(/[^A-Z0-9]/g, "").length;
          input.value = next;
          var pos = 0;
          var seen = 0;
          while (pos < next.length && seen < left) {
            if (/[A-Z0-9]/.test(next.charAt(pos))) seen++;
            pos++;
          }
          try { input.setSelectionRange(pos, pos); } catch (e) {}
        }

        input.addEventListener("input", applyFormat);
        input.addEventListener("blur", applyFormat);
        applyFormat();
      })();
    </script>
</body>
</html>
