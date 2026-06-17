#!/usr/bin/env python3
import argparse
import base64
import datetime as dt
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def main(argv=None, env=None):
    argv = sys.argv[1:] if argv is None else argv
    env = os.environ if env is None else env
    args = parse_args(argv)
    api_url = require_env(env, "KLOVR_SHARE_API_URL").rstrip("/")
    token = require_env(env, "KLOVR_SHARE_TOKEN")

    if args.command == "delete":
        request_json(api_url, token, "DELETE", f"/api/artifacts/{quote_path(args.slug)}", None)
        print(json.dumps({"deleted": True, "slug": args.slug}, indent=2))
        return 0

    with open(args.file, "r", encoding="utf-8") as handle:
        html = handle.read()

    payload = build_payload(args, html)
    if args.command == "publish":
        response = request_json(api_url, token, "POST", "/api/artifacts", payload)
    else:
        response = request_json(api_url, token, "PUT", f"/api/artifacts/{quote_path(args.slug)}", payload)
    print(json.dumps(response, indent=2))
    return 0


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Publish HTML artifacts to Klovr Share.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    publish = subparsers.add_parser("publish", help="Publish a new HTML artifact.")
    add_file_args(publish)
    publish.add_argument("--upsert", action="store_true", help="Update the existing slug if it already exists.")

    update = subparsers.add_parser("update", help="Update an existing HTML artifact.")
    add_file_args(update, title_required=False)
    update.add_argument("--clear-password", action="store_true", help="Remove password protection.")

    delete = subparsers.add_parser("delete", help="Delete an existing HTML artifact.")
    delete.add_argument("--slug", required=True)

    args = parser.parse_args(argv)
    if getattr(args, "expires_in", None) and getattr(args, "expires_at", None):
        parser.error("Use only one of --expires-in or --expires-at")
    return args


def add_file_args(parser, title_required=False):
    parser.add_argument("file")
    parser.add_argument("--slug", required=True)
    parser.add_argument("--title", required=title_required)
    parser.add_argument("--expires-in")
    parser.add_argument("--expires-at")
    parser.add_argument("--password")
    parser.add_argument("--assets-dir", help="Directory of local assets referenced by the HTML, served under assets/.")


def build_payload(args, html):
    expires_at = resolve_expiry(getattr(args, "expires_in", None), getattr(args, "expires_at", None))
    assets = read_assets_from_directory(args.assets_dir) if getattr(args, "assets_dir", None) else None
    if args.command == "publish":
        payload = {
            "slug": args.slug,
            "title": args.title or title_from_file(args.file),
            "html": html,
            "assets": assets,
            "expiresAt": expires_at,
            "password": args.password,
            "upsert": True if args.upsert else None,
        }
    else:
        payload = {
            "title": args.title,
            "html": html,
            "assets": assets,
            "expiresAt": expires_at,
            "password": None if args.clear_password else args.password,
        }
    return {key: value for key, value in payload.items() if value is not None}


def resolve_expiry(expires_in, expires_at):
    if expires_at:
        if expires_at.lower() == "never":
            return None
        parse_iso_datetime(expires_at)
        return expires_at
    if not expires_in:
        return None

    amount_text = expires_in[:-1]
    unit = expires_in[-1:]
    if not amount_text.isdigit() or int(amount_text) <= 0 or unit not in {"m", "h", "d"}:
        raise ValueError("Invalid --expires-in value. Use values like 30m, 12h, or 7d.")
    amount = int(amount_text)
    delta = {
        "m": dt.timedelta(minutes=amount),
        "h": dt.timedelta(hours=amount),
        "d": dt.timedelta(days=amount),
    }[unit]
    return (dt.datetime.now(dt.timezone.utc) + delta).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def request_json(api_url, token, method, path, payload):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{api_url}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            **({"Content-Type": "application/json"} if data is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else None
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8")
        raise RuntimeError(f"Klovr Share API failed with {error.code}: {body}") from error


def require_env(env, key):
    value = env.get(key)
    if not value:
        raise ValueError(f"{key} is required")
    return value


def quote_path(value):
    return urllib.parse.quote(value, safe="")


def parse_iso_datetime(value):
    normalized = value.replace("Z", "+00:00")
    try:
        dt.datetime.fromisoformat(normalized)
    except ValueError as error:
        raise ValueError(f"Invalid ISO timestamp: {value}") from error


def title_from_file(path):
    name = os.path.basename(path)
    return name[:-5] if name.lower().endswith(".html") else name


def read_assets_from_directory(directory):
    assets = []
    for root, _dirs, files in os.walk(directory):
        for filename in files:
            absolute_path = os.path.join(root, filename)
            relative_path = os.path.relpath(absolute_path, directory).replace(os.sep, "/")
            with open(absolute_path, "rb") as handle:
                body = handle.read()
            assets.append({
                "path": relative_path,
                "contentBase64": base64.b64encode(body).decode("ascii"),
                "contentType": mimetypes.guess_type(relative_path)[0] or "application/octet-stream",
            })
    return sorted(assets, key=lambda asset: asset["path"])


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
