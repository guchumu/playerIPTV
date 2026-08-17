<?php
require_once dirname(__DIR__) . '/config.php';

header('Content-Type: application/json; charset=utf-8');
@ini_set('memory_limit', '256M');

$cacheFile = sys_get_temp_dir() . '/streambox_epg.json';
$now = time();

if (is_file($cacheFile) && ($now - filemtime($cacheFile)) < EPG_CACHE_TTL) {
    readfile($cacheFile);
    exit;
}

function parse_xmltv_time($value)
{
    $value = trim((string) $value);
    if (!preg_match('/^(\d{14})(?:\s*([+-]\d{4}))?/', $value, $m)) {
        return 0;
    }
    $tz = !empty($m[2]) ? $m[2] : date('O');
    $dt = DateTime::createFromFormat('YmdHis O', $m[1] . ' ' . $tz);
    return $dt ? $dt->getTimestamp() : 0;
}

$xmlRaw = @file_get_contents(EPG_SOURCE);
if ($xmlRaw === false && is_file($cacheFile)) {
    readfile($cacheFile);
    exit;
}

if ($xmlRaw === false) {
    echo json_encode(array('updated' => null, 'channels' => new stdClass()));
    exit;
}

libxml_use_internal_errors(true);
$xml = simplexml_load_string($xmlRaw);
if (!$xml) {
    if (is_file($cacheFile)) {
        readfile($cacheFile);
        exit;
    }
    echo json_encode(array('updated' => null, 'channels' => new stdClass()));
    exit;
}

$channels = array();
foreach ($xml->programme as $programme) {
    $channelId = (string) $programme['channel'];
    if ($channelId === '') {
        continue;
    }
    $start = parse_xmltv_time((string) $programme['start']);
    $stop = parse_xmltv_time((string) $programme['stop']);
    if ($start <= 0 || $stop <= 0) {
        continue;
    }
    $title = trim((string) $programme->title);
    if ($title === '') {
        $title = 'Sin título';
    }

    if (!isset($channels[$channelId])) {
        $channels[$channelId] = array('now' => null, 'next' => null);
    }

    if ($start <= $now && $now < $stop) {
        $channels[$channelId]['now'] = array(
            'title' => $title,
            'start' => date('H:i', $start),
            'stop' => date('H:i', $stop),
        );
    } elseif ($start >= $now) {
        $currentNext = $channels[$channelId]['next'];
        if ($currentNext === null || $start < (int) $currentNext['_ts']) {
            $channels[$channelId]['next'] = array(
                'title' => $title,
                'start' => date('H:i', $start),
                'stop' => date('H:i', $stop),
                '_ts' => $start,
            );
        }
    }
}

foreach ($channels as $id => $info) {
    if (isset($channels[$id]['next']['_ts'])) {
        unset($channels[$id]['next']['_ts']);
    }
    if ($info['now'] === null && $info['next'] === null) {
        unset($channels[$id]);
    }
}

$payload = json_encode(array(
    'updated' => date('c'),
    'channels' => $channels,
));

@file_put_contents($cacheFile, $payload);
echo $payload;
