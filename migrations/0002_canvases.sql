CREATE TABLE IF NOT EXISTS canvases(owner TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,operation TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,updated TEXT NOT NULL,PRIMARY KEY(owner,id));
CREATE TABLE IF NOT EXISTS canvas_versions(owner TEXT NOT NULL,canvas_id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(owner,canvas_id,revision));
CREATE TABLE IF NOT EXISTS canvas_assets(owner TEXT NOT NULL,canvas_id TEXT NOT NULL,revision INTEGER NOT NULL,blob_id TEXT NOT NULL,PRIMARY KEY(owner,canvas_id,revision,blob_id),FOREIGN KEY(owner,canvas_id,revision) REFERENCES canvas_versions(owner,canvas_id,revision) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_canvas_asset_blob ON canvas_assets(owner,blob_id);
CREATE INDEX IF NOT EXISTS idx_canvases_updated ON canvases(owner,updated);
