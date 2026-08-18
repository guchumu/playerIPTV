<?php
/**
 * Listado y metadatos de los banners del player.
 * Las imágenes viven en ads/; los enlaces opcionales en ads/links.json.
 */
function ads_dir()
{
    $dir = __DIR__ . '/ads';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

function ads_ext_ok($ext)
{
    $ext = strtolower((string) $ext);
    return in_array($ext, array('jpg', 'jpeg', 'png', 'webp', 'gif'), true);
}

function ads_is_image_name($name)
{
    $base = basename((string) $name);
    if ($base === '' || $base !== (string) $name) {
        return false;
    }
    return (bool) preg_match('/^[A-Za-z0-9._-]{1,80}\.(jpe?g|png|webp|gif)$/i', $base);
}

function ads_meta_path()
{
    return ads_dir() . '/links.json';
}

function ads_clamp_interval($ms)
{
    $ms = (int) $ms;
    if ($ms < 3000) {
        $ms = 3000;
    }
    if ($ms > 60000) {
        $ms = 60000;
    }
    return $ms;
}

function ads_sanitize_href($href)
{
    $href = trim((string) $href);
    if ($href === '') {
        return '';
    }
    if (!preg_match('#^https?://#i', $href)) {
        return '';
    }
    return $href;
}

function ads_read_meta()
{
    $defaults = array('interval' => 9000, 'links' => array());
    $path = ads_meta_path();
    if (!is_file($path)) {
        return $defaults;
    }
    $data = json_decode((string) @file_get_contents($path), true);
    if (!is_array($data)) {
        return $defaults;
    }
    $links = array();
    if (!empty($data['links']) && is_array($data['links'])) {
        foreach ($data['links'] as $file => $href) {
            if (ads_is_image_name($file)) {
                $clean = ads_sanitize_href($href);
                if ($clean !== '') {
                    $links[$file] = $clean;
                }
            }
        }
    }
    $interval = isset($data['interval']) ? $data['interval'] : 9000;
    return array(
        'interval' => ads_clamp_interval($interval),
        'links' => $links,
    );
}

function ads_write_meta($meta)
{
    $interval = ads_clamp_interval(isset($meta['interval']) ? $meta['interval'] : 9000);
    $links = array();
    if (!empty($meta['links']) && is_array($meta['links'])) {
        foreach ($meta['links'] as $file => $href) {
            if (!ads_is_image_name($file)) {
                continue;
            }
            $clean = ads_sanitize_href($href);
            if ($clean !== '') {
                $links[$file] = $clean;
            }
        }
    }
    $payload = json_encode(
        array('interval' => $interval, 'links' => $links),
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
    );
    return @file_put_contents(ads_meta_path(), $payload, LOCK_EX) !== false;
}

function ads_list_files()
{
    $dir = ads_dir();
    $files = array();
    $entries = @scandir($dir);
    if (!is_array($entries)) {
        return $files;
    }
    foreach ($entries as $entry) {
        if (!ads_is_image_name($entry)) {
            continue;
        }
        if (!is_file($dir . '/' . $entry)) {
            continue;
        }
        $files[] = $entry;
    }
    sort($files, SORT_STRING);
    return $files;
}

function ads_public_payload()
{
    $meta = ads_read_meta();
    $ads = array();
    foreach (ads_list_files() as $file) {
        $item = array(
            'file' => $file,
            'src' => 'ads/' . rawurlencode($file),
        );
        if (!empty($meta['links'][$file])) {
            $item['href'] = $meta['links'][$file];
        }
        $ads[] = $item;
    }
    return array(
        'interval' => $meta['interval'],
        'ads' => $ads,
    );
}
