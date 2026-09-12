<?php
session_start();
require_once dirname(__DIR__) . '/config.php';
require_once dirname(__DIR__) . '/dns_lib.php';

if (empty($_SESSION['admin_logged_in'])) {
    header('Location: login.php');
    exit;
}

$flash = '';
$flashType = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = isset($_POST['domains']) ? (string) $_POST['domains'] : '';
    $lines = preg_split('/\R/', $raw);
    if (dns_save_domains($lines)) {
        $flash = 'Lista de dominios guardada.';
        $flashType = 'ok';
    } else {
        $flash = 'No se pudo escribir data/dns_check_domains.json. Revisa permisos.';
        $flashType = 'error';
    }
}

$domains = dns_load_domains();
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dominios de bloqueo - StreamBox</title>
    <link rel="stylesheet" href="admin_style.css">
</head>
<body>
    <header>
        <div class="header-left">
            <h1>Dominios de bloqueo</h1>
            <span class="admin-user"><?php echo htmlspecialchars($_SESSION['admin_username']); ?></span>
        </div>
        <a href="index.php" class="btn btn-secondary">Volver al panel</a>
    </header>

    <div class="container">
        <div class="dns-admin-card">
            <p>Un dominio por línea. La app los comprueba con <a href="https://deinser.com/cloudflare/laliga/?domain=deinser.com&amp;json=1" target="_blank" rel="noopener">deinser</a> y las IPs de <a href="https://hayahora.futbol/" target="_blank" rel="noopener">hayahora.futbol</a>.</p>
            <p>Máximo <?php echo (int) DNS_DOMAINS_MAX; ?> dominios. Sirve para ver si hay corte de fútbol y si esas webs caen en IPs bloqueadas.</p>
            <?php if ($flash): ?>
                <p class="dns-flash <?php echo $flashType === 'ok' ? 'dns-flash-ok' : 'dns-flash-error'; ?>"><?php echo htmlspecialchars($flash); ?></p>
            <?php endif; ?>
            <form method="post" action="dns.php">
                <label for="domains">Dominios</label>
                <textarea id="domains" name="domains" rows="12"><?php echo htmlspecialchars(implode("\n", $domains)); ?></textarea>
                <button type="submit" class="btn btn-primary">Guardar lista</button>
            </form>
        </div>
    </div>
</body>
</html>
