<?php
/**
 * Lista los banners actuales. El player consulta esto al cargar;
 * si no hay imágenes, responde vacío y no se pinta hueco.
 */
require_once __DIR__ . '/ads_lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=30');
header('Access-Control-Allow-Origin: *');

echo json_encode(ads_public_payload());
