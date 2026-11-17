-- ライセンスキー（クライアントごと）と、同時に使える端末の紐付け。キー本体は保存せず SHA-256 だけを持つ。
-- expires_at は「この日まで使える」最終日（日本時間・YYYY-MM-DD）。NULL は無期限。
CREATE TABLE IF NOT EXISTS licenses(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 key_hash TEXT NOT NULL UNIQUE,
 client_name TEXT NOT NULL,
 plan TEXT NOT NULL DEFAULT 'pro',
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','suspended')),
 expires_at TEXT,
 max_devices INTEGER NOT NULL DEFAULT 1,
 swaps_month TEXT NOT NULL DEFAULT '',
 swaps_count INTEGER NOT NULL DEFAULT 0,
 render_monthly_limit INTEGER NOT NULL DEFAULT 300,
 transcribe_monthly_min_limit INTEGER NOT NULL DEFAULT 1200,
 note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL
);
-- 端末の紐付け。revoked_at が NULL の行が「今使える端末」（max_devices 件まで）
CREATE TABLE IF NOT EXISTS activations(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 license_id INTEGER NOT NULL REFERENCES licenses(id),
 device_id TEXT NOT NULL,
 device_name TEXT NOT NULL DEFAULT '',
 activated_at TEXT NOT NULL,
 last_seen TEXT NOT NULL,
 revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_activations_live ON activations(license_id,device_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_activations_license ON activations(license_id,revoked_at);
-- 月ごとの利用量。month は日本時間の YYYY-MM。feature: render（回数）／transcribe_sec（秒）
CREATE TABLE IF NOT EXISTS license_usage(
 license_id INTEGER NOT NULL,
 month TEXT NOT NULL,
 feature TEXT NOT NULL,
 count INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(license_id,month,feature)
);
-- キー総当たり対策：IP ごと・15分枠ごとの失敗回数
CREATE TABLE IF NOT EXISTS license_attempts(
 ip TEXT NOT NULL,
 slot INTEGER NOT NULL,
 count INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(ip,slot)
);
