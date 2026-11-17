"""外構スケッチ Pro のライセンスキー発行・管理（D1 の licenses / activations）。

キー本体は保存しない。発行時に標準出力へ一度だけ表示し、D1 には SHA-256 だけを入れる。
ハッシュの規則は worker/license.ts の normalizeKey と同じ（大文字・英数字だけにそろえる）。

使い方（既定は SQL を表示するだけ。--apply remote で本番 D1、--apply local で手元の D1 に流す）:
  python scripts/license_admin.py new --client "山田外構" --plan pro [--max-devices 1] [--expires 2027-03-31] [--note "..."] [--apply remote]
  python scripts/license_admin.py list [--apply remote]
  python scripts/license_admin.py suspend --id 3 [--apply remote]      # 停止（resume で戻す）
  python scripts/license_admin.py resume --id 3 [--apply remote]
  python scripts/license_admin.py reset-device --id 3 [--apply remote] # 紐付けを全部外し、今月の切り替え回数も0に
  （--id の代わりに --key GS-XXXX-... でも指定できる）
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import secrets
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# 0/O・1/I/L など紛らわしい文字は使わない
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
DB_NAME = "gofg-exterior-sketch"
PROFILE = "gofg-kawakahi"


def new_key() -> str:
    return "GS-" + "-".join("".join(secrets.choice(ALPHABET) for _ in range(4)) for _ in range(4))


def normalize(key: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", key.upper())


def key_hash(key: str) -> str:
    return hashlib.sha256(normalize(key).encode()).hexdigest()


def q(v: str | None) -> str:
    return "NULL" if v is None else "'" + v.replace("'", "''") + "'"


def target(args) -> str:
    if args.id is not None:
        return f"id={int(args.id)}"
    if args.key:
        return f"key_hash={q(key_hash(args.key))}"
    sys.exit("--id か --key を指定してください")


def sql_new(args, key: str) -> str:
    if args.expires and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.expires):
        sys.exit("--expires は YYYY-MM-DD で指定してください")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return (
        "INSERT INTO licenses(key_hash,client_name,plan,status,expires_at,max_devices,render_monthly_limit,transcribe_monthly_min_limit,note,created_at) VALUES("
        f"{q(key_hash(key))},{q(args.client)},{q(args.plan)},'active',{q(args.expires)},{int(args.max_devices)},"
        f"{int(args.render_limit)},{int(args.transcribe_min_limit)},{q(args.note or '')},{q(now)});"
    )


LIST_SQL = (
    "SELECT l.id,l.client_name,l.plan,l.status,l.expires_at,l.max_devices,"
    "(SELECT COUNT(*) FROM activations a WHERE a.license_id=l.id AND a.revoked_at IS NULL) AS devices,"
    "(SELECT group_concat(a.device_name||' '||substr(a.last_seen,1,16),' / ') FROM activations a WHERE a.license_id=l.id AND a.revoked_at IS NULL) AS device_list,"
    "l.swaps_month,l.swaps_count,l.note,l.created_at FROM licenses l ORDER BY l.id;"
)


def run_sql(sql: str, where: str) -> int:
    """wrangler d1 execute で流す（scripts/cloudflare-account.mjs と同じプロファイル・設定）。"""
    env = dict(os.environ)
    for k in ("CLOUDFLARE_API_TOKEN", "CF_API_TOKEN", "CLOUDFLARE_API_KEY", "CF_API_KEY", "CLOUDFLARE_EMAIL", "CF_EMAIL", "CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID"):
        env.pop(k, None)
    fd, path = tempfile.mkstemp(suffix=".sql")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(sql + "\n")
        cmd = ["node", str(ROOT / "node_modules/wrangler/bin/wrangler.js"), "d1", "execute", DB_NAME, f"--{where}", "--file", path,
               "--config", str(ROOT / ".wrangler/deploy.wrangler.jsonc")]
        if where == "remote":
            cmd += ["--profile", PROFILE]
        return subprocess.run(cmd, cwd=ROOT, env=env).returncode
    finally:
        os.remove(path)


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):  # Windows の端末でも日本語が化けないように
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    p = argparse.ArgumentParser(description="外構スケッチ Pro ライセンス管理")
    sub = p.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("new", help="キーを発行する（キーは一度だけ表示）")
    n.add_argument("--client", required=True, help="会社名（アプリの設定画面に表示）")
    n.add_argument("--plan", default="pro")
    n.add_argument("--max-devices", type=int, default=1, help="同時に使える端末数（審査用は多めに）")
    n.add_argument("--expires", help="この日まで使える（YYYY-MM-DD・日本時間）。省略で無期限")
    n.add_argument("--render-limit", type=int, default=300, help="AIパースの月上限（回）")
    n.add_argument("--transcribe-min-limit", type=int, default=1200, help="文字起こしの月上限（分）")
    n.add_argument("--note", default="")
    sub.add_parser("list", help="一覧（使用中の端末つき）")
    for name in ("suspend", "resume", "reset-device"):
        s = sub.add_parser(name)
        s.add_argument("--id", type=int)
        s.add_argument("--key")
    for s in sub.choices.values():
        s.add_argument("--apply", choices=["remote", "local"], help="D1 へ流す。省略時は SQL を表示するだけ")
    args = p.parse_args(argv)

    if args.cmd == "new":
        if args.max_devices < 1:
            sys.exit("--max-devices は1以上")
        key = new_key()
        sql = sql_new(args, key)
    elif args.cmd == "list":
        key, sql = None, LIST_SQL
    elif args.cmd in ("suspend", "resume"):
        key, sql = None, f"UPDATE licenses SET status='{'suspended' if args.cmd == 'suspend' else 'active'}' WHERE {target(args)};"
    else:
        t = target(args)
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        key, sql = None, (f"UPDATE activations SET revoked_at={q(now)} WHERE revoked_at IS NULL AND license_id IN (SELECT id FROM licenses WHERE {t});\n"
                          f"UPDATE licenses SET swaps_count=0 WHERE {t};")

    if args.apply:
        code = run_sql(sql, args.apply)
        if code != 0:
            print("D1 への反映に失敗しました（キーは無効のまま）。", file=sys.stderr)
            return code
    else:
        print("-- 次の SQL を D1 に流してください（--apply remote でこのツールから流せます）", file=sys.stderr)
        print(sql)
    if key:
        print(f"\nライセンスキー（この表示は一度だけ。控えてクライアントへ渡してください）: {key}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
