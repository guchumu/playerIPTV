<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$input = file_get_contents('php://input');
$data = json_decode($input, true);

// Este archivo es opcional, solo para estadísticas
echo json_encode(['success' => true]);
?>
