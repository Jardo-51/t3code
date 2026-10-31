# Custom usage limits

Track a monthly spending limit in dollars, such as a corporate API budget, next to your
subscription limits on the **Limits** tab of the Usage page.

A custom limit adds up the priced usage of the providers you choose, from 00:00 UTC on the 1st of
each month, when it resets. Prices are the same list prices the Usage page shows, including your
custom prices. Add a markup when your endpoint charges more than the list price, for example 10 for
an endpoint that costs 10% more.

## Adding a limit

Settings → Providers → **Custom usage limits** → **Add limit**. Give it a name, the monthly amount
in USD, the markup, and the providers that count towards it.

Providers on other machines can count too: pick them from any connected environment. The limit is
saved on the environment whose settings you edit, and shows on the Limits tab while that
environment is selected.

## Things to know

- Claude, Codex, Grok and Pi providers can count towards a limit. The usage of OpenCode, Cursor and
  Antigravity comes from an account or the whole machine rather than a provider, so they cannot.
- Spend from an environment only counts while it is connected. The limit says which environments
  are missing.
- Usage is attributed through each provider's history folder, so give the providers that count
  towards a limit their own one (for Claude, the **CLAUDE_CONFIG_DIR path** setting). When a
  provider shares its folder with one outside the limit, both count, and the limit says so.
- Requests to models without a known price are not counted. Add a custom price for them on the
  Usage page.

Custom limits need a server from this fork. Web and desktop clients show them; the mobile app does
not yet.
