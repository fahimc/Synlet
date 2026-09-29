# Cloudflare Tunnel runbook

Synlet is published at `https://synlet.m8e.co.uk` through the dedicated named tunnel
`synlet-local` (`c1071a25-dd95-4da8-b799-21f32bd5da8c`). The connector uses
`config/cloudflared.synlet.yml` and forwards only to the authenticated loopback proxy
on `127.0.0.1:43129`; Synlet itself remains bound to `127.0.0.1:43127`.

Do not point the tunnel directly at port 43127. The web bundle must call Synlet's local
API and therefore contains its loopback bearer token. Direct publication would expose
the unrestricted `command.run` capability to anonymous Internet users.

## Start

Start Synlet first:

```powershell
pnpm dev:local
```

In a second terminal, start the authentication proxy:

```powershell
node scripts/authenticated-tunnel-proxy.mjs
```

The first start creates a random username/password/session credential at
`runtime-data/cloudflare/basic-auth.json`. This ignored runtime file must not be
committed or shared in logs.

In a third terminal, start the connector with the explicit config. The explicit config
is important because this host has another default Cloudflare tunnel configuration.

```powershell
cloudflared --config config/cloudflared.synlet.yml tunnel --no-autoupdate --protocol http2 run c1071a25-dd95-4da8-b799-21f32bd5da8c
```

## Verify

- An anonymous request to `https://synlet.m8e.co.uk/` must return HTTP 401.
- After browser Basic authentication, the UI must load over HTTPS.
- UI API calls use the short-lived HttpOnly proxy session cookie plus Synlet's own
  loopback bearer authentication.
- `cloudflared tunnel info synlet-local` should list active connections.

## Rotate or stop

To rotate browser credentials, stop the proxy, remove only
`runtime-data/cloudflare/basic-auth.json`, and restart the proxy. It creates a new
random credential. Existing browser sessions stop working because their cookie no
longer matches.

Stop the proxy and connector processes to take the public endpoint offline. Removing
the DNS route or deleting the tunnel is not required for a temporary shutdown.

## Preferred long-term authentication

Create a Cloudflare Access self-hosted application for `synlet.m8e.co.uk`, allow only
the intended identities, and enable tunnel-side Access token validation. Keep the
local proxy until Access has been verified from an unauthenticated browser; then it can
be replaced with an Access-aware origin adapter. Never remove authentication merely
because the tunnel itself uses an outbound-only connection.
