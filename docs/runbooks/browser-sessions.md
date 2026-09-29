# Browser session runbook

Synlet browser automation uses Playwright Core, an explicit executable and a dedicated
profile under the configured data root. It never opens a personal profile.

- Allow only domains approved by host policy. Redirects are rechecked.
- Prefer accessible roles/names and observe the resulting page after each action.
- Stop at login, CAPTCHA, payment, publication or uncertain consequential actions.
- Close the owned context on success, cancellation or failure.
- Delete only the explicitly configured dedicated profile when resetting browser
  state; this does not affect Edge's normal profile.
