<?php
if (isset($_GET['url']) && !isset($_GET['u'])) {
    $_GET['u'] = $_GET['url'];
}
require __DIR__ . '/hls_proxy.php';
