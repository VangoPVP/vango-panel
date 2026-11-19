<?php
/**
 * phpMyAdmin settings for Vango Panel. Loaded by the official image after its own config.inc.php
 * (where $i is the last configured server, i.e. 1).
 *
 * Users only get in through the panel's one-time signon links (vango-signon.php); there is no login
 * form, no arbitrary-server login, and the MariaDB host comes from the panel per login.
 */

declare(strict_types=1);

$vangoAbsolute = (string) getenv('PMA_ABSOLUTE_URI');
$vangoBase = $vangoAbsolute !== '' ? rtrim($vangoAbsolute, '/') . '/' : '';
$vangoSecure = str_starts_with($vangoAbsolute, 'https://');

$i = 1;
$cfg['Servers'][$i] = [
    'verbose' => 'Vango Panel',
    // Placeholder: vango-signon.php sets the real host/port for every login.
    'host' => '127.0.0.1',
    'port' => '3306',
    'auth_type' => 'signon',
    'SignonSession' => 'VangoSignon',
    'SignonURL' => $vangoBase . 'vango-signon.php',
    'LogoutURL' => $vangoBase . 'vango-signon.php?logout=1',
    // Must match start_signon_session() in vango-signon.php.
    'SignonCookieParams' => [
        'lifetime' => 0,
        'path' => '/',
        'domain' => '',
        'secure' => $vangoSecure,
        'httponly' => true,
        'samesite' => 'Lax',
    ],
    'compress' => false,
    'AllowNoPassword' => false,
    'AllowRoot' => false,
    'hide_db' => '^(information_schema|performance_schema|mysql|sys)$',
];

$cfg['AllowArbitraryServer'] = false;
$cfg['ServerDefault'] = 1;
// Users can't create databases (the panel does that) or change their password (the panel would
// lose track of it; use "Rotate password" instead).
$cfg['ShowCreateDb'] = false;
$cfg['ShowChgPassword'] = false;
$cfg['LoginCookieValidity'] = 3600;
$cfg['VersionCheck'] = false;
$cfg['SendErrorReports'] = 'never';
$cfg['ShowPhpInfo'] = false;
$cfg['ShowServerInfo'] = false;
