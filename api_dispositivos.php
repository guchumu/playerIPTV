<?php
// api_dispositivos.php - El puente entre el portal y la TV
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

function rs_format_device_id($raw) {
    $id = strtoupper(preg_replace('/[^A-Z0-9]/', '', (string) $raw));
    if (strlen($id) === 6) {
        return substr($id, 0, 2) . '-' . substr($id, 2, 2) . '-' . substr($id, 4, 2);
    }
    return strtoupper(trim((string) $raw));
}

function rs_device_paths($dir, $id) {
    return array(
        $dir . $id . '.json',
        $dir . str_replace('-', '', $id) . '.json',
    );
}

function rs_wipe_device_assignment($dir, $id) {
    $empty = json_encode(array('status' => 'esperando', 'ts' => (int) round(microtime(true) * 1000)));
    $n = 0;
    foreach (rs_device_paths($dir, $id) as $ruta) {
        if (!is_file($ruta)) {
            continue;
        }
        // Primero se vacía el JSON para que un GET no pueda resucitar la lista.
        @file_put_contents($ruta, $empty);
        if (@unlink($ruta)) {
            $n++;
        } else {
            $n++;
        }
    }
    return $n;
}

$id = isset($_GET['id']) ? rs_format_device_id($_GET['id']) : '';
if ($id === '' && isset($_POST['id'])) {
    $id = rs_format_device_id($_POST['id']);
}
if ($id === '' || !preg_match('/^[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}$/', $id)) {
    echo json_encode(array('status' => 'esperando'));
    exit;
}

$action = '';
if (isset($_GET['action'])) {
    $action = strtolower(trim((string) $_GET['action']));
} elseif (isset($_POST['action'])) {
    $action = strtolower(trim((string) $_POST['action']));
}

$dir = __DIR__ . '/cuentas/';
$candidatos = rs_device_paths($dir, $id);

if ($action === 'clear' || $action === 'wipe' || $action === 'logout') {
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
    rs_wipe_device_assignment($dir, $id);
    echo json_encode(array('status' => 'esperando', 'cleared' => true));
    exit;
}

$archivo = null;
foreach ($candidatos as $ruta) {
    if (is_file($ruta)) {
        $archivo = $ruta;
        break;
    }
}

if ($archivo !== null) {
    // Si estaba sin guiones, migrar al formato canónico.
    $canonico = $dir . $id . '.json';
    if ($archivo !== $canonico) {
        @rename($archivo, $canonico);
        $archivo = is_file($canonico) ? $canonico : $archivo;
    }
    $datos = file_get_contents($archivo);
    echo $datos;
} else {
    echo json_encode(array('status' => 'esperando'));
}
