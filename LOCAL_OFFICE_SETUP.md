# OZMO local office setup (legacy)

> This guide documents the former private-LAN deployment. New production
> deployments should use
> [docs/HOSTINGER-DEPLOYMENT.md](docs/HOSTINGER-DEPLOYMENT.md).

OZMO is designed to stay inside the office network. Employees open it from
their browser, but it is not published on the public internet. Login is still
required even while connected to the office network.

## What the office computer needs

- A Mac, Windows PC, or small server that stays on during working hours.
- Node.js 22.13 or newer.
- A fixed private network address, such as `192.168.1.20`.
- Automatic date and time enabled, with the timezone set to
  `Asia/Damascus`.
- A daily backup of the local application data.

Use a wired connection where possible. Disable sleep on the server during
Saturday–Wednesday, 10:00 AM–6:15 PM, so reminders can run reliably.

## Private network checklist

1. Give the OZMO computer a fixed address in the office router.
2. Allow the application port only on the private office network in the
   computer firewall.
3. Do **not** configure router port forwarding, a public tunnel, or a public
   DNS record.
4. Connect employee devices to the office Wi-Fi or wired network.
5. Use only a private IP address, `localhost`, or an internal `.local` name.
6. Test from office Wi-Fi, then confirm the same address does not open over
   mobile data.

The network restriction and username/password login protect different layers.
Keep both enabled.

## Application settings

Create a local `.env.local` file on the server. Keep it private and out of
backups that other employees can read.

```text
OZMO_SCHEDULER_KEY=replace-with-a-long-random-private-value
OZMO_BASE_URL=http://127.0.0.1:3000
```

The authentication layer accepts localhost, private IPv4/IPv6 addresses and
`.local` office hostnames. The office firewall remains the main network
boundary. Do not use a public hostname or a broad internet firewall rule.

For development, start the application, then start the reminder worker in a
second terminal:

```text
pnpm run dev
node scripts/local-scheduler.mjs
```

For normal daily use, build once and start both services together:

```text
pnpm run build
pnpm run office
```

Configure `pnpm run office` to start automatically when the office computer
restarts. The scheduler calls the local app once per minute and does not contact
a public service.

## Reminder behavior

All deadline checks use `Asia/Damascus`, not the employee device timezone.

- Saturday–Wednesday at 5:15 PM: first report reminder.
- 5:25 PM: second reminder only if that employee has not submitted.
- 6:00 PM: administrators receive a missing-report escalation.
- Submitting a report stops all later reminders for that day.
- Thursday and Friday: no daily-report reminders.
- At 11:00 AM every day, the account manager who created each still-scheduled
  session receives a reminder. Starting the server later performs the same-day
  catch-up once.
- Sessions are never cancelled, removed, or marked missed automatically. They
  remain scheduled until an account manager or administrator updates them.
- Cancelled and missed sessions notify administrators and account managers.
- Low inventory and session-needed alerts are held until
  `inventory_ready=true`. Turn this on only after the starting Draft, Shot Reel,
  Finished Reel, and Post counts have been entered.
- A client enters **Session needed** when its combined Finished Reel + Shot Reel
  coverage is 4 or lower by default. Each client can use a different threshold.
- Daily administrator summaries default to 6:05 PM. Weekly summaries default
  to Wednesday at 6:10 PM.

Every scheduler action is deduplicated. Restarting the scheduler does not send
the same reminder again.

## Browser notifications

OZMO now uses standards-based Web Push. Each employee’s browser registers a
separate encrypted device subscription. The reminder service sends bilingual
alerts through the browser vendor’s push service, so a notification can arrive
after the OZMO tab is closed. Expired device subscriptions are disabled
automatically, and the in-app notification center remains the fallback.

Two conditions cannot be bypassed by application code:

1. Phones must open OZMO from a **trusted HTTPS** office address.
2. A person who previously selected **Block** must re-enable the website in
   browser or operating-system settings.

`http://localhost` is treated as secure only on the OZMO computer itself.
`http://192.168.x.x` is not a secure origin on a phone, so Chrome, Samsung
Internet, and Safari will block Service Workers and Web Push.

### Prepare the private HTTPS address

First reserve the OZMO computer’s private IP address in the router. The
certificate must contain that exact address. Then, from the app directory:

```text
pnpm run https:setup
pnpm run build
```

The setup creates:

- `.certs/ozmo-office-ca-key.pem` — the private office authority key. Never
  share this file.
- `public/ozmo-office-ca.crt` — the public PEM trust certificate for Apple
  devices and computers.
- `public/ozmo-office-ca-android.cer` — the public DER CA certificate for
  Android.
- A server certificate for `localhost`, `ozmo.local`, `127.0.0.1`, and the
  detected private office IP.

If the server IP changes, generate a new certificate only after moving the old
`.certs` folder to a secure backup. Replacing the office authority means every
device must trust the new certificate again.

After all managed devices trust the public certificate, start the secure app:

```text
pnpm run office:https
```

Employees then use the HTTPS address printed by the server, such as
`https://192.168.1.196:3000`. Do not continue through a certificate warning:
the address must show as trusted first.

### Dedicated Windows host at 192.168.1.211

The file `Start OZMO Host - Windows 10 - 192.168.1.211.bat` is reserved for
the Windows laptop whose router reservation is `192.168.1.211`. It uses a
separate server-certificate profile and does not replace the existing
`192.168.1.196` Mac/default certificate. Start only one OZMO host at a time.

- Application: `https://192.168.1.211:3000`
- Device setup: `http://192.168.1.211:3001`

Because both server certificates use the same OZMO office CA, devices that
already trust the current CA do not need to install a different authority.
However, `192.168.1.211` is a new website origin. Each employee must open the
new address, sign in, and enable browser notifications again on that device.
If the Windows laptop no longer owns `.211`, its dedicated launcher stops and
asks for the router reservation to be restored; it does not alter certificates
or company data.

The Windows launcher keeps the laptop awake during normal idle time and
automatically restarts OZMO if one of its services exits. Keep its window open.
Its persistent log is `%LOCALAPPDATA%\OZMO\logs\host.log`. Use `C:\OZMO` for
the host and keep it outside OneDrive, Dropbox, Desktop, Documents, and network
shares. The complete Windows package contains a prebuilt app, so normal daily
startup does not rebuild it. Closing a laptop lid may still force sleep
according to Windows power settings; set the plugged-in lid action to
**Do nothing** if OZMO must run with the lid closed.

### New-phone setup page

Starting OZMO with HTTPS also starts a certificate-only onboarding page:

```text
http://192.168.1.196:3001
```

This page contains no login, staff reports, passwords, private keys, or company
records. It serves only the public Apple profile, Android CA, certificate
fingerprint, and setup instructions. It must never be exposed with router port
forwarding.

If this HTTP page cannot open, the problem is network reachability: confirm
the Mac is running, both devices are on the normal office Wi-Fi rather than
Guest Wi-Fi, AP/client isolation is disabled, the phone has a
`192.168.1.x` Wi-Fi address, and VPN/Secure Wi-Fi is off while testing.

### Install the Android certificate

1. Open `http://192.168.1.196:3001` and tap **Download Android CA**.
2. Open Android **Settings → Security & privacy → More security settings →
   Install a certificate → CA certificate**. Menu names vary slightly by
   Samsung/Android version.
3. Confirm with the phone PIN or password, then choose
   `ozmo-office-ca-android.cer`.
4. Do **not** choose **VPN & app certificate** or **Wi-Fi certificate**. Those
   categories expect a private key and cause the “Private key required”
   message. The OZMO private CA key must never leave the office computer.
5. Reopen the exact OZMO HTTPS address, confirm there is no certificate
   warning, then open OZMO Settings and tap **Enable** or **Send test**.

### Install the certificate on Windows or macOS

Open `http://192.168.1.196:3001` on the laptop.

On Windows:

1. Select **Windows certificate**, open the downloaded file, and choose
   **Install Certificate**.
2. Choose **Current User**.
3. Choose **Place all certificates in the following store**, then select
   **Trusted Root Certification Authorities**. Do not place it in Personal.
4. Finish the wizard, completely close every Chrome and Edge window, and reopen
   the exact OZMO HTTPS address.

On macOS:

1. Select **macOS certificate** and add it to Keychain Access.
2. Open **OZMO Office Local CA**, expand **Trust**, and select
   **Always Trust**.
3. Close Keychain Access, completely quit Chrome or Edge, and reopen OZMO.

If an OZMO certificate was installed before but the browser still reports an
SSL error, remove the older OZMO Office certificate/profile and install the
current download again. Compare its SHA-256 fingerprint with the value shown on
the device-setup page. Never continue through the browser’s certificate warning:
the main page may appear, but the browser will still reject the Service Worker.

### Install the Apple profile

1. In Safari, open `http://192.168.1.196:3001` and tap
   **Download Apple profile**.
2. Open Settings → **Profile Downloaded** → **Install**. The manually generated
   local profile may be labelled “Not Signed”; it contains only the public
   certificate.
3. Open Settings → General → About → **Certificate Trust Settings** and enable
   full trust for **OZMO Office CA**.
4. Reopen `https://192.168.1.196:3000` in Safari. If requested, allow Local
   Network access.
5. Select Share → Add to Home Screen, open OZMO from its Home Screen icon, and
   enable notifications.

### Keep OZMO running on the Mac

Install the per-user background service once:

```text
pnpm run office:install-mac
```

It starts OZMO at Mac login, automatically restarts it after a crash, runs the
reminder scheduler and device-setup page, and prevents idle system sleep while
the Mac is connected to power. Status and removal commands are:

```text
pnpm run office:status-mac
pnpm run office:uninstall-mac
```

For a larger managed team, the smoother option is an owned hostname with
private/split office DNS pointing to the LAN computer and a publicly trusted
certificate obtained through DNS validation. This avoids installing an
internal authority on every phone while keeping the app inaccessible outside
the office.

The OZMO computer and employee devices need outbound internet access to browser
push services. No inbound public connection or router port forwarding is
required.

### Google Chrome

1. Open the trusted HTTPS OZMO address.
2. Sign in, open **Help & rules**, and select **Enable** under browser
   notifications.
3. Select **Allow** in Chrome’s prompt.
4. If OZMO reports that permission is blocked, open the site information icon,
   open site settings, change Notifications to **Allow**, and reload OZMO.
5. If OZMO reports a certificate error, reinstall the current certificate from
   the device-setup page before changing notification permissions.
6. On Android, also confirm that Android allows notifications for the Chrome
   application, permits them on the lock screen, and does not battery-optimize
   or deep-sleep Chrome.

On macOS or Windows, also allow Chrome in the operating system’s notification
settings. Browser permission alone cannot override a system-level block.

### Mozilla Firefox

1. Open the trusted HTTPS OZMO address in a current Firefox version.
2. Sign in, open **Help & rules**, select **Enable**, then **Allow**.
3. If no native alert appears, allow OZMO in Firefox site permissions and allow
   Firefox in macOS System Settings or Windows Notification settings.

### Samsung Internet

1. Open the trusted HTTPS OZMO address in Samsung Internet.
2. Sign in, open **Help & rules**, select **Enable**, then **Allow**.
3. If blocked, check the website permission under Samsung Internet settings and
   the Android notification permission for the Samsung Internet application.
   Enable lock-screen notifications and exclude Samsung Internet from sleeping
   apps when alerts are delayed.

### Xiaomi, Redmi, Infinix and Honor

Use a current Google Chrome installation on devices that include Google Play
Services. Install the OZMO Android CA first, allow notifications for both the
OZMO website and Chrome application, and exclude Chrome from aggressive
battery-saving or deep-sleep lists when notifications are delayed.

### Huawei without Google Play Services

The private OZMO website can work after its CA is installed, but standard
Chrome/FCM browser push cannot be promised on a Huawei device without Google
Play Services. Universal critical reminders require a second channel such as
WhatsApp Business; a native Huawei-specific implementation would require a
separate HMS Push Kit account and integration.

### iPhone and iPad

iOS/iPadOS 16.4 or newer is required. Notification permission is not available
to OZMO in a normal Safari tab.

1. Open the trusted HTTPS OZMO address in Safari.
2. Select **Share → Add to Home Screen** and confirm **Open as Web App** when
   shown.
3. Launch OZMO from its Home Screen icon.
4. Sign in, open **Help & rules**, select **Enable**, then **Allow**.
5. If blocked, open iPhone Settings, find OZMO under Notifications, and enable
   **Allow Notifications**.

Every employee must repeat the enable process on each browser or device they
want to receive notifications on.

## First launch and passwords

No permanent passwords are shipped with OZMO. On first launch:

1. Set a password for one administrator through the secure setup screen.
2. Sign in and assign a temporary password to each employee.
3. Require the employee to replace it at first login.
4. Disable accounts immediately when someone leaves the company.

Never send all passwords in one group chat, and never reuse the same password
for every employee.

## WhatsApp status

WhatsApp delivery is not enabled in this private local build. It requires a
Meta WhatsApp Business account, an approved sending number, approved bilingual
message templates, and internet access. Delivery-status webhooks also require a
public HTTPS callback or an explicitly approved secure gateway, which is a
separate decision from the office-only browser app.

## Daily operating check

- Confirm the OZMO app and scheduler are running before 5:15 PM.
- Confirm the server clock shows Damascus time.
- Check the admin notification center after 6:00 PM.
- Back up the database after working hours.
- Review scheduled/cancelled/missed sessions and low inventory from the dashboard.
