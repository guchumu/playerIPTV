<?php
/**
 * Subida de banners del player. Entra con la sesión del panel admin
 * o, si está definida, con ADS_UPLOAD_KEY en config.local.php.
 */
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/ads_lib.php';

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

function ads_key_enabled()
{
    return defined('ADS_UPLOAD_KEY') && ADS_UPLOAD_KEY !== '';
}

function ads_is_authed()
{
    if (!empty($_SESSION['admin_logged_in'])) {
        return true;
    }
    if (!empty($_SESSION['ads_upload_ok']) && ads_key_enabled()) {
        return true;
    }
    return false;
}

function ads_flash($type, $text)
{
    $_SESSION['ads_flash'] = array('type' => $type, 'text' => $text);
}

function ads_redirect()
{
    header('Location: ads_upload.php');
    exit;
}

$authed = ads_is_authed();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = isset($_POST['action']) ? (string) $_POST['action'] : '';

    if ($action === 'key_login') {
        $given = isset($_POST['ads_key']) ? (string) $_POST['ads_key'] : '';
        if (ads_key_enabled() && hash_equals(ADS_UPLOAD_KEY, $given)) {
            $_SESSION['ads_upload_ok'] = true;
            ads_redirect();
        }
        ads_flash('error', 'Clave incorrecta.');
        ads_redirect();
    }

    if (!$authed) {
        http_response_code(403);
        ads_flash('error', 'No autorizado.');
        ads_redirect();
    }

    if ($action === 'upload') {
        if (empty($_FILES['image']) || !is_uploaded_file($_FILES['image']['tmp_name'])) {
            ads_flash('error', 'No se recibió ninguna imagen.');
            ads_redirect();
        }
        $file = $_FILES['image'];
        if ($file['error'] !== UPLOAD_ERR_OK) {
            ads_flash('error', 'Error al subir el archivo (código ' . (int) $file['error'] . ').');
            ads_redirect();
        }
        if ($file['size'] > 2 * 1024 * 1024) {
            ads_flash('error', 'La imagen supera los 2 MB.');
            ads_redirect();
        }
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($file['tmp_name']);
        $mimeToExt = array(
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            'image/gif' => 'gif',
        );
        if (!isset($mimeToExt[$mime])) {
            ads_flash('error', 'Solo se admiten JPG, PNG, WebP o GIF.');
            ads_redirect();
        }
        $name = bin2hex(random_bytes(8)) . '.' . $mimeToExt[$mime];
        $dest = ads_dir() . '/' . $name;
        if (!move_uploaded_file($file['tmp_name'], $dest)) {
            ads_flash('error', 'No se pudo guardar el archivo. Revisa permisos de ads/.');
            ads_redirect();
        }
        @chmod($dest, 0644);
        $href = ads_sanitize_href(isset($_POST['href']) ? $_POST['href'] : '');
        if ($href !== '') {
            $meta = ads_read_meta();
            $meta['links'][$name] = $href;
            ads_write_meta($meta);
        }
        ads_flash('ok', 'Imagen subida.');
        ads_redirect();
    }

    if ($action === 'delete') {
        $name = isset($_POST['file']) ? (string) $_POST['file'] : '';
        if (!ads_is_image_name($name)) {
            ads_flash('error', 'Nombre de archivo no válido.');
            ads_redirect();
        }
        $path = ads_dir() . '/' . $name;
        if (is_file($path)) {
            @unlink($path);
        }
        $meta = ads_read_meta();
        if (isset($meta['links'][$name])) {
            unset($meta['links'][$name]);
            ads_write_meta($meta);
        }
        ads_flash('ok', 'Imagen eliminada.');
        ads_redirect();
    }

    if ($action === 'save_link') {
        $name = isset($_POST['file']) ? (string) $_POST['file'] : '';
        if (!ads_is_image_name($name) || !is_file(ads_dir() . '/' . $name)) {
            ads_flash('error', 'Imagen no encontrada.');
            ads_redirect();
        }
        $href = ads_sanitize_href(isset($_POST['href']) ? $_POST['href'] : '');
        $raw = trim(isset($_POST['href']) ? (string) $_POST['href'] : '');
        if ($raw !== '' && $href === '') {
            ads_flash('error', 'El enlace debe empezar por http:// o https://.');
            ads_redirect();
        }
        $meta = ads_read_meta();
        if ($href === '') {
            unset($meta['links'][$name]);
        } else {
            $meta['links'][$name] = $href;
        }
        ads_write_meta($meta);
        ads_flash('ok', 'Enlace guardado.');
        ads_redirect();
    }

    if ($action === 'save_interval') {
        $seconds = isset($_POST['interval']) ? (int) $_POST['interval'] : 9;
        $meta = ads_read_meta();
        $meta['interval'] = ads_clamp_interval($seconds * 1000);
        ads_write_meta($meta);
        ads_flash('ok', 'Intervalo actualizado.');
        ads_redirect();
    }

    ads_redirect();
}

$flash = null;
if (!empty($_SESSION['ads_flash']) && is_array($_SESSION['ads_flash'])) {
    $flash = $_SESSION['ads_flash'];
    unset($_SESSION['ads_flash']);
}

$meta = ads_read_meta();
$files = $authed ? ads_list_files() : array();
$intervalSec = (int) round($meta['interval'] / 1000);
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Banners — StreamBox IPTV</title>
    <style>
        body { background: #020617; color: #e2e8f0; font-family: system-ui, sans-serif; margin: 0; padding: 2rem 1rem; }
        .wrap { max-width: 720px; margin: 0 auto; }
        h1 { color: #a5b4fc; font-size: 1.4rem; margin: 0 0 0.35rem; }
        .lead { color: #94a3b8; font-size: 0.9rem; margin: 0 0 1.4rem; }
        a { color: #818cf8; }
        .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 1.2rem; margin-bottom: 1rem; }
        label { display: block; font-size: 0.78rem; color: #94a3b8; margin: 0.7rem 0 0.3rem; }
        input[type="file"], input[type="url"], input[type="password"], input[type="number"] {
            width: 100%; box-sizing: border-box; padding: 0.55rem 0.7rem; border-radius: 8px;
            border: 1px solid #334155; background: #1e293b; color: #fff;
        }
        button, .btn {
            display: inline-block; margin-top: 0.8rem; padding: 0.55rem 0.9rem; border: 0; border-radius: 8px;
            background: #4f46e5; color: #fff; font-weight: 600; cursor: pointer; text-decoration: none; font-size: 0.9rem;
        }
        .btn-danger { background: #b91c1c; }
        .btn-ghost { background: #334155; }
        .msg { padding: 0.7rem 0.9rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem; }
        .msg.ok { background: rgba(34, 197, 94, 0.18); color: #4ade80; }
        .msg.error { background: rgba(239, 68, 68, 0.18); color: #f87171; }
        .item { display: grid; grid-template-columns: 140px 1fr; gap: 0.9rem; align-items: start; padding: 0.9rem 0; border-top: 1px solid #1e293b; }
        .item:first-child { border-top: 0; padding-top: 0; }
        .item img { width: 140px; height: 70px; object-fit: contain; background: #020617; border-radius: 8px; }
        .item form { margin: 0; }
        .item .row { display: flex; gap: 0.4rem; align-items: center; }
        .item .row input { margin: 0; }
        .item .row button { margin-top: 0; }
        .empty { color: #64748b; font-size: 0.9rem; }
        .nav { margin-bottom: 1.2rem; font-size: 0.85rem; }
    </style>
</head>
<body>
<div class="wrap">
    <div class="nav">
        <?php if (!empty($_SESSION['admin_logged_in'])): ?>
            <a href="admin/index.php">← Panel admin</a>
        <?php endif; ?>
    </div>
    <h1>Banners del reproductor</h1>
    <p class="lead">Franja discreta bajo la guía EPG, solo en PC ancho y TV. Si no hay imágenes, no se muestra nada.</p>

    <?php if ($flash): ?>
        <div class="msg <?php echo $flash['type'] === 'ok' ? 'ok' : 'error'; ?>">
            <?php echo htmlspecialchars($flash['text'], ENT_QUOTES, 'UTF-8'); ?>
        </div>
    <?php endif; ?>

    <?php if (!$authed): ?>
        <div class="card">
            <p>Inicia sesión en el <a href="admin/login.php">panel de administración</a> para gestionar los banners.</p>
            <?php if (ads_key_enabled()): ?>
                <form method="post">
                    <input type="hidden" name="action" value="key_login" />
                    <label>O introduce la clave ADS_UPLOAD_KEY</label>
                    <input type="password" name="ads_key" required autocomplete="current-password" />
                    <button type="submit">Entrar</button>
                </form>
            <?php endif; ?>
        </div>
    <?php else: ?>
        <div class="card">
            <strong>Subir imagen</strong>
            <form method="post" enctype="multipart/form-data">
                <input type="hidden" name="action" value="upload" />
                <label>Archivo (JPG, PNG, WebP o GIF · máx. 2 MB)</label>
                <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" required />
                <label>Enlace al pulsar (opcional)</label>
                <input type="url" name="href" placeholder="https://…" />
                <button type="submit">Subir</button>
            </form>
        </div>

        <div class="card">
            <form method="post">
                <input type="hidden" name="action" value="save_interval" />
                <label>Segundos entre imágenes</label>
                <input type="number" name="interval" min="3" max="60" value="<?php echo (int) $intervalSec; ?>" />
                <button type="submit">Guardar intervalo</button>
            </form>
        </div>

        <div class="card">
            <strong>Imágenes actuales</strong>
            <?php if (!$files): ?>
                <p class="empty">Ninguna. El player no mostrará la franja.</p>
            <?php else: ?>
                <?php foreach ($files as $file): ?>
                    <div class="item">
                        <img src="ads/<?php echo rawurlencode($file); ?>" alt="" />
                        <div>
                            <div class="empty"><?php echo htmlspecialchars($file, ENT_QUOTES, 'UTF-8'); ?></div>
                            <form method="post">
                                <input type="hidden" name="action" value="save_link" />
                                <input type="hidden" name="file" value="<?php echo htmlspecialchars($file, ENT_QUOTES, 'UTF-8'); ?>" />
                                <label>Enlace</label>
                                <div class="row">
                                    <input type="url" name="href" placeholder="https://…"
                                           value="<?php echo isset($meta['links'][$file]) ? htmlspecialchars($meta['links'][$file], ENT_QUOTES, 'UTF-8') : ''; ?>" />
                                    <button type="submit" class="btn-ghost">Guardar</button>
                                </div>
                            </form>
                            <form method="post" onsubmit="return confirm('¿Eliminar esta imagen?');">
                                <input type="hidden" name="action" value="delete" />
                                <input type="hidden" name="file" value="<?php echo htmlspecialchars($file, ENT_QUOTES, 'UTF-8'); ?>" />
                                <button type="submit" class="btn-danger">Eliminar</button>
                            </form>
                        </div>
                    </div>
                <?php endforeach; ?>
            <?php endif; ?>
        </div>
    <?php endif; ?>
</div>
</body>
</html>
