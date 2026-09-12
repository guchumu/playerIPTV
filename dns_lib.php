<?php
/**
 * Sondas de bloqueo DNS/ISP: lista TXT en el servidor, deinser, hayahora y DoH xdp.es.
 * Editar dominios: dns_check_domains.txt (un host por línea).
 */
require_once __DIR__ . '/player_lib.php';

define('DNS_XDP_IPV4', '85.208.114.51');
define('DNS_XDP_IPV6', '2a0e:97c0:c40::51');
define('DNS_XDP_DOT', 'dns.xdp.es');
define('DNS_XDP_DOH', 'https://dns.xdp.es/dns-query');
define('DNS_DOMAINS_MAX', 30);
define('DNS_CACHE_TTL', 60);
define('DNS_BROWSER_UA', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');

function dns_domains_file()
{
    $root = __DIR__ . '/dns_check_domains.txt';
    if (is_file($root)) {
        return $root;
    }
    return __DIR__ . '/data/dns_check_domains.txt';
}

function dns_cache_file()
{
    return player_cache_dir() . '/bloqueo_cache.json';
}

function dns_default_domains()
{
    return array(
        'deinser.com',
        'dle.rae.es',
        'nctdqkaw.k21fmcom.xyz',
        'hmdasdxu.k21fmcom.xyz',
        'gex68cd9.k21te.xyz',
    );
}

function dns_normalize_domain($raw)
{
    $s = strtolower(trim((string) $raw));
    if ($s === '') {
        return '';
    }
    if (strpos($s, '#') !== false) {
        $s = trim(strtok($s, '#'));
    }
    $s = preg_replace('#^https?://#', '', $s);
    $s = preg_replace('#/.*$#', '', $s);
    $s = preg_replace('/:\\d+$/', '', $s);
    if (!preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,24}$/', $s)) {
        return '';
    }
    if (strlen($s) > 253) {
        return '';
    }
    return $s;
}

function dns_load_domains()
{
    $out = array();
    $file = dns_domains_file();
    if (is_file($file)) {
        foreach (preg_split('/\\R/', (string) @file_get_contents($file)) as $line) {
            $d = dns_normalize_domain($line);
            if ($d !== '') {
                $out[] = $d;
            }
        }
    }
    $out = array_values(array_unique($out));
    if (!$out) {
        $out = dns_default_domains();
    }
    return array_slice($out, 0, DNS_DOMAINS_MAX);
}

function dns_curl_handle($url, $opts)
{
    $ch = curl_init();
    $headers = array('Accept-Language: es-ES,es;q=0.9,en;q=0.8');
    if (!empty($opts['accept'])) {
        $headers[] = 'Accept: ' . $opts['accept'];
    }
    $timeout = isset($opts['timeout']) ? (int) $opts['timeout'] : 8;
    curl_setopt_array($ch, array(
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_ENCODING => '',
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_USERAGENT => DNS_BROWSER_UA,
        CURLOPT_HTTPHEADER => $headers,
    ));
    return $ch;
}

function dns_http_one($url, $opts)
{
    $empty = array('ok' => false, 'code' => 0, 'error' => 'sin curl', 'body' => '');
    if (!function_exists('curl_init')) {
        return $empty;
    }
    $ch = dns_curl_handle($url, $opts);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = (string) curl_error($ch);
    curl_close($ch);
    return array(
        'ok' => $body !== false && $code >= 200 && $code < 400,
        'code' => $code,
        'error' => $err,
        'body' => $body === false ? '' : (string) $body,
    );
}

function dns_http_multi($jobs)
{
    $out = array();
    foreach ($jobs as $key => $job) {
        $out[$key] = array('ok' => false, 'code' => 0, 'error' => 'sin respuesta', 'body' => '');
    }
    if (!$jobs) {
        return $out;
    }
    if (!function_exists('curl_multi_init')) {
        foreach ($jobs as $key => $job) {
            $out[$key] = dns_http_one($job['url'], $job);
        }
        return $out;
    }
    $mh = curl_multi_init();
    $handles = array();
    foreach ($jobs as $key => $job) {
        $ch = dns_curl_handle($job['url'], $job);
        $handles[$key] = $ch;
        curl_multi_add_handle($mh, $ch);
    }
    $running = null;
    do {
        $status = curl_multi_exec($mh, $running);
        if ($running) {
            curl_multi_select($mh, 1.0);
        }
    } while ($running && $status === CURLM_OK);
    foreach ($handles as $key => $ch) {
        $body = curl_multi_getcontent($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = (string) curl_error($ch);
        $out[$key] = array(
            'ok' => $body !== false && $body !== null && $code >= 200 && $code < 400,
            'code' => $code,
            'error' => $err,
            'body' => ($body === false || $body === null) ? '' : (string) $body,
        );
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }
    curl_multi_close($mh);
    return $out;
}

function dns_skip_name($raw, $offset)
{
    $len = strlen($raw);
    $guard = 0;
    while ($offset < $len && $guard++ < 64) {
        $label = ord($raw[$offset]);
        if ($label === 0) {
            return $offset + 1;
        }
        if (($label & 0xC0) === 0xC0) {
            return $offset + 2;
        }
        $offset += 1 + $label;
    }
    return $offset;
}

function dns_parse_a_records($raw)
{
    if (strlen($raw) < 12) {
        return array();
    }
    $qd = unpack('n', substr($raw, 4, 2));
    $an = unpack('n', substr($raw, 6, 2));
    $qdcount = $qd ? (int) $qd[1] : 0;
    $ancount = $an ? (int) $an[1] : 0;
    $offset = 12;
    $len = strlen($raw);
    for ($i = 0; $i < $qdcount; $i++) {
        $offset = dns_skip_name($raw, $offset);
        $offset += 4;
    }
    $ips = array();
    for ($i = 0; $i < $ancount && $offset + 10 <= $len; $i++) {
        $offset = dns_skip_name($raw, $offset);
        if ($offset + 10 > $len) {
            break;
        }
        $typeParts = unpack('n', substr($raw, $offset, 2));
        $rdParts = unpack('n', substr($raw, $offset + 8, 2));
        $type = $typeParts ? (int) $typeParts[1] : 0;
        $rdlength = $rdParts ? (int) $rdParts[1] : 0;
        $offset += 10;
        if ($type === 1 && $rdlength === 4 && $offset + 4 <= $len) {
            $ips[] = sprintf(
                '%d.%d.%d.%d',
                ord($raw[$offset]),
                ord($raw[$offset + 1]),
                ord($raw[$offset + 2]),
                ord($raw[$offset + 3])
            );
        }
        $offset += $rdlength;
    }
    return array_values(array_unique($ips));
}

function dns_build_query($domain)
{
    $id = random_int(0, 65535);
    $header = pack('nnnnnn', $id, 0x0100, 1, 0, 0, 0);
    $qname = '';
    foreach (explode('.', $domain) as $label) {
        $len = strlen($label);
        if ($len < 1 || $len > 63) {
            return '';
        }
        $qname .= chr($len) . $label;
    }
    $qname .= "\0";
    return $header . $qname . pack('nn', 1, 1);
}

function dns_doh_url($domain)
{
    $msg = dns_build_query($domain);
    if ($msg === '') {
        return '';
    }
    $b64 = rtrim(strtr(base64_encode($msg), '+/', '-_'), '=');
    return DNS_XDP_DOH . '?dns=' . $b64;
}

function dns_parse_ip_list($text)
{
    $ips = array();
    foreach (preg_split('/\\R/', (string) $text) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        $parts = preg_split('/\\s+/', $line);
        $ip = $parts[0];
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            $ips[] = $ip;
        }
    }
    return array_values(array_unique($ips));
}

function dns_xdp_info()
{
    return array(
        'name' => 'xdp.es',
        'about' => 'https://xdp.es/',
        'ipv4' => DNS_XDP_IPV4,
        'ipv6' => DNS_XDP_IPV6,
        'dot' => DNS_XDP_DOT,
        'doh' => DNS_XDP_DOH,
        'private_dns' => DNS_XDP_DOT,
    );
}

function dns_build_report($force)
{
    $cacheFile = dns_cache_file();
    if (!$force && is_file($cacheFile) && (time() - filemtime($cacheFile)) < DNS_CACHE_TTL) {
        $cached = json_decode((string) @file_get_contents($cacheFile), true);
        if (is_array($cached) && !empty($cached['ok'])) {
            $cached['from_cache'] = true;
            return $cached;
        }
    }

    $domains = dns_load_domains();
    $jobs = array(
        'hayahora' => array(
            'url' => 'https://hayahora.futbol/estado/blocked-any.txt',
            'accept' => 'text/plain',
            'timeout' => 8,
        ),
    );
    foreach ($domains as $i => $domain) {
        $jobs['deinser_' . $i] = array(
            'url' => 'https://deinser.com/cloudflare/laliga/?domain=' . rawurlencode($domain) . '&json=1',
            'accept' => 'application/json,text/html;q=0.8',
            'timeout' => 8,
        );
        $doh = dns_doh_url($domain);
        if ($doh !== '') {
            $jobs['doh_' . $i] = array(
                'url' => $doh,
                'accept' => 'application/dns-message',
                'timeout' => 8,
            );
        }
        $jobs['https_' . $i] = array(
            'url' => 'https://' . $domain . '/',
            'accept' => '*/*',
            'timeout' => 5,
        );
        $jobs['http_' . $i] = array(
            'url' => 'http://' . $domain . '/',
            'accept' => '*/*',
            'timeout' => 5,
        );
    }

    $fetched = dns_http_multi($jobs);
    $blockedIps = dns_parse_ip_list(isset($fetched['hayahora']['body']) ? $fetched['hayahora']['body'] : '');
    $blockedSet = array_fill_keys($blockedIps, true);
    $futbol = count($blockedIps) > 0;
    $rows = array();

    foreach ($domains as $i => $domain) {
        $deinserRaw = isset($fetched['deinser_' . $i]['body']) ? $fetched['deinser_' . $i]['body'] : '';
        $deinser = json_decode($deinserRaw, true);
        if (!is_array($deinser) || !isset($deinser['domain'])) {
            $deinser = null;
        }
        $xdpIps = array();
        if (!empty($fetched['doh_' . $i]['ok'])) {
            $xdpIps = dns_parse_a_records($fetched['doh_' . $i]['body']);
        }
        $listed = array();
        $sourceIps = array();
        $domainBlocked = false;
        if (is_array($deinser)) {
            if (!empty($deinser['futbol_blocking_active'])) {
                $futbol = true;
            }
            $sourceIps = isset($deinser['domain_ips']) && is_array($deinser['domain_ips']) ? $deinser['domain_ips'] : array();
            $listed = isset($deinser['blocked_ips']) && is_array($deinser['blocked_ips']) ? $deinser['blocked_ips'] : array();
            $domainBlocked = !empty($deinser['domain_blocked']);
        }
        foreach (array_merge($sourceIps, $xdpIps) as $ip) {
            if (isset($blockedSet[$ip])) {
                $listed[] = $ip;
                $domainBlocked = true;
            }
        }
        $listed = array_values(array_unique($listed));
        $httpsHint = !empty($fetched['https_' . $i]['ok']);
        $httpHint = !empty($fetched['http_' . $i]['ok']);
        $rows[] = array(
            'domain' => $domain,
            'blocked' => $domainBlocked,
            'cloudflare' => is_array($deinser) ? !empty($deinser['domain_with_cloudflare_proxy']) : null,
            'ips' => array_values(array_unique($sourceIps)),
            'blocked_ips' => $listed,
            'xdp_ips' => $xdpIps,
            'xdp_ip_blocked' => count(array_intersect($xdpIps, $listed)) > 0,
            'deinser_ok' => is_array($deinser),
            'resolved' => count($sourceIps) > 0 || count($xdpIps) > 0,
            'reachable_https' => $httpsHint,
            'reachable_http' => $httpHint,
        );
    }

    $report = array(
        'ok' => true,
        'from_cache' => false,
        'checked_at' => gmdate('c'),
        'futbol_blocking_active' => $futbol,
        'hayahora' => array(
            'blocked_ip_count' => count($blockedIps),
            'source' => 'https://hayahora.futbol/estado/blocked-any.txt',
            'site' => 'https://hayahora.futbol/',
        ),
        'xdp' => dns_xdp_info(),
        'domains' => $rows,
        'how_to' => array(
            'private_dns' => DNS_XDP_DOT,
            'ipv4' => DNS_XDP_IPV4,
            'ipv6' => DNS_XDP_IPV6,
            'doh' => DNS_XDP_DOH,
            'hint' => 'Esta app no puede cambiar el DNS del aparato. En Android: Ajustes → Red e Internet → DNS privado → dns.xdp.es. Luego pulsa Comprobar.',
        ),
    );

    @file_put_contents($cacheFile, json_encode($report), LOCK_EX);
    return $report;
}
