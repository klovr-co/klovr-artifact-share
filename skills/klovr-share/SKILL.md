---
name: klovr-share
description: Publish, update, or delete Klovr-hosted HTML artifact links from an agent using KLOVR_SHARE_API_URL and KLOVR_SHARE_TOKEN. Use when the user wants to share a local HTML artifact, protect it with a viewer password, set an expiry, keep the same URL while updating, or unshare a previously published Klovr artifact.
---

# Klovr Share

Use this skill to turn a local HTML artifact into a Klovr-hosted link through the Klovr Share API.

## Requirements

Before publishing, verify:

- The artifact has a main `.html` file.
- Images and videos can use absolute public URLs, inline `data:` URLs, or bundled private assets.
- When the HTML references local files, place them in an assets directory and reference them as `assets/...` in the HTML. Publish with `--assets-dir`.
- `KLOVR_SHARE_API_URL` is set to the deployed service URL, such as `https://share.example.com`.
- `KLOVR_SHARE_TOKEN` is set for an approved publisher.
- The user has specified an expiry or accepts the service default/no expiry.
- Password protection is applied when the user requests it or when the artifact should not be public.

Never print `KLOVR_SHARE_TOKEN`.

For a deployed service, provide the API URL and publisher token through the agent environment:

```bash
export KLOVR_SHARE_API_URL="https://share.example.com"
export KLOVR_SHARE_TOKEN="<publisher-token>"
```

Never commit publisher tokens or paste them into chat.

## Publish

Run:

```bash
python skills/klovr-share/scripts/klovr_share.py publish ./artifact.html --slug demo --title "Demo" --expires-in 7d --password "viewer-secret"
```

For local images/videos:

```bash
python skills/klovr-share/scripts/klovr_share.py publish ./artifact.html --assets-dir ./assets --slug demo --expires-in 7d --password "viewer-secret"
```

Useful flags:

- `--slug`: stable URL slug.
- `--title`: viewer page title.
- `--expires-in`: relative expiry such as `30m`, `12h`, or `7d`.
- `--expires-at`: absolute ISO timestamp such as `2026-07-01T00:00:00.000Z`.
- `--password`: viewer password.
- `--assets-dir`: local directory served under `assets/...` with the same password and expiry protection.
- `--upsert`: update the existing slug if it already exists.

After publishing, report the returned `url`, whether it is password protected, and the expiry.

## Update Same URL

Run:

```bash
python skills/klovr-share/scripts/klovr_share.py update ./artifact.html --slug demo --expires-in 3d
```

Use `--password` to replace the viewer password. Use `--clear-password` to remove password protection.

## Delete

Run:

```bash
python skills/klovr-share/scripts/klovr_share.py delete --slug demo
```

Report that the link has been removed. Do not claim deletion if the command fails.
