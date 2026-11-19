<?php
/**
 * Vango Panel → phpMyAdmin single sign-on.
 *
 *   ?token=…   One-time token from the panel's "phpMyAdmin" button. Redeemed server-to-server at
 *              <VANGO_PANEL_INTERNAL_URL>/api/phpmyadmin/redeem with the shared secret; the returned
 *              credentials go into phpMyAdmin's signon session and the browser is sent to the database.
 *   ?logout=1  phpMyAdmin's LogoutURL: forgets the signon credentials and returns to the panel.
 *   (nothing)  phpMyAdmin sends users here when they aren't signed in (or a login failed).
 */

declare(strict_types=1);

const SIGNON_SESSION = 'VangoSignon';

header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'");

$panelUrl = rtrim((string) getenv('VANGO_PANEL_URL'), '/');
$internalUrl = rtrim((string) getenv('VANGO_PANEL_INTERNAL_URL'), '/');
$secret = (string) getenv('VANGO_SIGNON_SECRET');
// Behind an https reverse proxy the container itself only sees http.
$secure = str_starts_with((string) getenv('PMA_ABSOLUTE_URI'), 'https://');

function e(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function page(int $status, string $title, string $message): never
{
    global $panelUrl;
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    $back = preg_match('#^https?://#i', $panelUrl) === 1
        ? '<p><a href="' . e($panelUrl) . '">Back to the panel</a></p>'
        : '';
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>' . e($title) . '</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#222}'
        . 'h1{font-size:1.25rem}a{color:#2563eb}@media(prefers-color-scheme:dark){body{background:#111;color:#ddd}a{color:#60a5fa}}</style></head>'
        . '<body><h1>' . e($title) . '</h1><p>' . e($message) . '</p>' . $back . '</body></html>';
    exit;
}

function start_signon_session(): void
{
    global $secure;
    // Must match SignonCookieParams in config.user.inc.php.
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Lax']);
    session_name(SIGNON_SESSION);
    session_start();
}

/** @return array{host: string, port: int, username: string, password: string, database: string} */
function redeem(string $token): array
{
    global $internalUrl, $secret;
    if (preg_match('#^https?://#i', $internalUrl) !== 1 || strlen($secret) < 32) {
        page(500, 'phpMyAdmin is misconfigured', 'VANGO_PANEL_INTERNAL_URL or VANGO_SIGNON_SECRET is not set. Ask an administrator.');
    }
    // curl, not file_get_contents: the phpMyAdmin image sets allow_url_fopen=Off.
    $ch = curl_init($internalUrl . '/api/phpmyadmin/redeem');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['token' => $token]),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json', "Authorization: Bearer {$secret}"],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 10,
    ]);
    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    if (!is_string($body) || $status === 0) {
        page(502, 'Panel unreachable', 'phpMyAdmin could not reach the panel to complete the login. Try again in a moment.');
    }
    $data = json_decode($body, true);
    if ($status !== 200) {
        $message = is_array($data) && is_string($data['error'] ?? null)
            ? $data['error']
            : "The panel rejected the login (HTTP {$status}).";
        page($status === 401 ? 500 : 403, 'Could not sign in', $status === 401
            ? 'phpMyAdmin and the panel do not share the same signon secret. Ask an administrator.'
            : $message);
    }
    if (
        !is_array($data)
        || !is_string($data['host'] ?? null) || !is_int($data['port'] ?? null)
        || !is_string($data['username'] ?? null) || !is_string($data['password'] ?? null)
        || !is_string($data['database'] ?? null)
    ) {
        page(502, 'Could not sign in', 'The panel sent an unexpected response.');
    }
    return $data;
}

// Logout: drop the signon credentials, then go back to the panel.
if (isset($_GET['logout'])) {
    start_signon_session();
    $_SESSION = [];
    session_destroy();
    if (preg_match('#^https?://#i', $panelUrl) === 1) {
        header('Location: ' . $panelUrl, true, 303);
        exit;
    }
    page(200, 'Signed out', 'You have been signed out of phpMyAdmin.');
}

$token = $_GET['token'] ?? null;
if (!is_string($token) || $token === '') {
    start_signon_session();
    $error = $_SESSION['PMA_single_signon_error_message'] ?? null;
    unset($_SESSION['PMA_single_signon_error_message']);
    if (is_string($error) && $error !== '') {
        page(403, 'Could not sign in', strip_tags($error));
    }
    page(401, 'Open phpMyAdmin from the panel', "Use the phpMyAdmin button on your server's Databases tab in the panel. Links are single-use and expire after a minute.");
}
if (preg_match('/^[A-Za-z0-9_-]{43}$/', $token) !== 1) {
    page(400, 'Invalid link', 'This phpMyAdmin link is malformed. Open phpMyAdmin from the panel again.');
}

$db = redeem($token);

start_signon_session();
session_regenerate_id(true);
$_SESSION = [
    'PMA_single_signon_user' => $db['username'],
    'PMA_single_signon_password' => $db['password'],
    'PMA_single_signon_host' => $db['host'],
    'PMA_single_signon_port' => (string) $db['port'],
    // Only show the server's own database in the navigation.
    'PMA_single_signon_cfgupdate' => ['only_db' => $db['database']],
];
session_write_close();

// Redirecting also drops the token from the address bar and history.
header('Location: index.php?route=/database/structure&db=' . rawurlencode($db['database']), true, 303);
exit;
