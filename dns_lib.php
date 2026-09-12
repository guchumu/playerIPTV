<?php
/**
 * Lista de dominios (admin) + sondas de bloqueo (deinser / hayahora) + DoH xdp.es.
 */

define('DNS_XDP_IPV4', '85.208.114.51');
define('DNS_XDP_IPV6', '2a0e:97c0:c40::51');
define('DNS_XDP_DOT', 'dns.xdp.es');
define('DNS_XDP_DOH', 'https://dns.xdp.es/dns-query');
define('DNS_DOMAINS_MAX', 20);
define('DNS_CACHE_TTL', 90);

function dns_data_dir()
{
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

function dns_domains_file()
{
    return dns_data_dir() . '/dns_check_domains.json';
}

function dns_cache_file()
{
    return dns_data_dir() . '/bloqueo_cache.json';
}

function dns_normalize_domain($raw)
{
    $s = strtolower(trim((string) $raw));
    if ($s === '') {
        return '';
    }
    $s = preg_replace('#^https?://#', '', $s);
    $s = preg_replace('#/.*$#', '', $s);
    $s = preg_replace('/:\d+$/', '', $s);
    if (!preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/', $s)) {
        return '';
    }
    return $s;
}

function dns_load_domains()
{
    $data = json_decode((string) @file_get_contents(dns_domains_file()), true);
    $out = array();
    if (is_array($data) && isset($data['domains']) && is_array($data['domains'])) {
        foreach ($data['domains'] as $item) {
            $d = dns_normalize_domain($item);
            if ($d !== '') {
                $out[] = $d;
            }
        }
    }
    $out = array_values(array_unique($out));
    if (!$out) {
        $out = array('deinser.com', 'dle.rae.es', 'www.rae.es');
    }
    return array_slice($out, 0, DNS_DOMAINS_MAX);
}

function dns_save_domains($domains)
{
    $clean = array();
    foreach ((array) $domains as $item) {
        $d = dns_normalize_domain($item);
        if ($d !== '') {
            $clean[] = $d;
        }
    }
    $clean = array_slice(array_values(array_unique($clean)), 0, DNS_DOMAINS_MAX);
    $json = json_encode(array('domains' => $clean), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    $ok = @file_put_contents(dns_domains_file(), $json . "\n") !== false;
    @unlink(dns_cache_file());
    return $ok;
}

function dns_http_get($url, $accept, $timeout)
{
    if (!function_exists('curl_init')) {
        return '';
    }
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 6);
    curl_setopt($ch, CURLOPT_ENCODING, '');
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_HTTPHEADER, array('Accept: ' . $accept));
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 StreamBox/1.0');
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false || $code >= 400) {
        return '';
    }
    return (string) $body;
}

function dns_skip_name($raw, $offset)
{
    $len = strlen($raw);
    while ($offset < $len) {
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

function dns_xdp_resolve($domain)
{
    $id = random_int(0, 65535);
    $header = pack('nnnnnn', $id, 0x0100, 1, 0, 0, 0);
    $qname = '';
    foreach (explode('.', $domain) as $label) {
        $qname .= chr(strlen($label)) . $label;
    }
    $qname .= "\0";
    $msg = $header . $qname . pack('nn', 1, 1);
    $b64 = rtrim(strtr(base64_encode($msg), '+/', '-_'), '=');
    $raw = dns_http_get(DNS_XDP_DOH . '?dns=' . $b64, 'application/dns-message', 8);
    return dns_parse_a_records($raw);
}

function dns_deinser_check($domain)
{
    $url = 'https://deinser.com/cloudflare/laliga/?domain=' . rawurlencode($domain) . '&json=1';
    $raw = dns_http_get($url, 'application/json', 10);
    $data = json_decode($raw, true);
    if (!is_array($data) || !isset($data['domain'])) {
        return null;
    }
    return $data;
}

function dns_hayahora_blocked_ips()
{
    $raw = dns_http_get('https://hayahora.futbol/estado/blocked-any.txt', 'text/plain', 8);
    $ips = array();
    foreach (preg_split('/\R/', (string) $raw) as $line) {
        $ip = trim($line);
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
    $blockedIps = dns_hayahora_blocked_ips();
    $blockedSet = array_fill_keys($blockedIps, true);
    $futbol = count($blockedIps) > 0;
    $rows = array();

    foreach ($domains as $domain) {
        $deinser = dns_deinser_check($domain);
        $xdpIps = dns_xdp_resolve($domain);
        $listed = array();
        $sourceIps = array();
        if (is_array($deinser)) {
            if (!empty($deinser['futbol_blocking_active'])) {
                $futbol = true;
            }
            $sourceIps = isset($deinser['domain_ips']) && is_array($deinser['domain_ips']) ? $deinser['domain_ips'] : array();
            $listed = isset($deinser['blocked_ips']) && is_array($deinser['blocked_ips']) ? $deinser['blocked_ips'] : array();
            $domainBlocked = !empty($deinser['domain_blocked']);
        } else {
            $sourceIps = $xdpIps;
            $domainBlocked = false;
        }
        foreach (array_merge($sourceIps, $xdpIps) as $ip) {
            if (isset($blockedSet[$ip])) {
                $listed[] = $ip;
                $domainBlocked = true;
            }
        }
        $listed = array_values(array_unique($listed));
        $rows[] = array(
            'domain' => $domain,
            'blocked' => $domainBlocked,
            'cloudflare' => is_array($deinser) ? !empty($deinser['domain_with_cloudflare_proxy']) : null,
            'ips' => array_values(array_unique($sourceIps)),
            'blocked_ips' => $listed,
            'xdp_ips' => $xdpIps,
            'deinser_ok' => is_array($deinser),
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
            'hint' => 'En Android: Ajustes → Red → DNS privado → dns.xdp.es. Luego pulsa Comprobar: si un dominio no llegaba y ahora sí, las DNS nuevas están actuando. Si el operador corta la IP (no solo el DNS), hará falta otra red o una VPN.',
        ),
    );

    @file_put_contents($cacheFile, json_encode($report));
    return $report;
}
