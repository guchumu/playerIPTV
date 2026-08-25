<?php
// api_dispositivos.php - El puente entre el portal y la TV
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json');

function rs_format_device_id($raw) {
    $id = strtoupper(preg_replace('/[^A-Z0-9]/', '', (string) $raw));
    if (strlen($id) === 6) {
        return substr($id, 0, 2) . '-' . substr($id, 2, 2) . '-' . substr($id, 4, 2);
    }
    return strtoupper(trim((string) $raw));
}

$id = isset($_GET['id']) ? rs_format_device_id($_GET['id']) : '';
if ($id === '' || !preg_match('/^[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}$/', $id)) {
    echo json_encode(array('status' => 'esperando'));
    exit;
}

$dir = __DIR__ . '/cuentas/';
$candidatos = array(
    $dir . $id . '.json',
    $dir . str_replace('-', '', $id) . '.json',
);

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
