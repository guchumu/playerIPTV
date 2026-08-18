<?php
// api_dispositivos.php - El puente entre el portal y la TV
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json');

$id = isset($_GET['id']) ? strtoupper(trim($_GET['id'])) : '';
if ($id === '' || !preg_match('/^[A-Z0-9-]{4,16}$/', $id)) {
    echo json_encode(array('status' => 'esperando'));
    exit;
}

$archivo = __DIR__ . '/cuentas/' . $id . '.json';

if (is_file($archivo)) {
    // La asignación se deja en disco: cerrar sesión no debe obligar a volver a
    // subir la lista. Una carga nueva (upload.php) sobrescribe el mismo fichero.
    $datos = file_get_contents($archivo);
    echo $datos;
} else {
    echo json_encode(array('status' => 'esperando'));
}
