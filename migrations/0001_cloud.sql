CREATE TABLE IF NOT EXISTS blobs(owner TEXT NOT NULL,id TEXT NOT NULL,bytes INTEGER NOT NULL,parts INTEGER NOT NULL,hashes TEXT NOT NULL,media TEXT NOT NULL,name TEXT NOT NULL,complete INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,PRIMARY KEY(owner,id));
CREATE TABLE IF NOT EXISTS chunks(owner TEXT NOT NULL,blob_id TEXT NOT NULL,n INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,blob_id,n),FOREIGN KEY(owner,blob_id) REFERENCES blobs(owner,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS plans(owner TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,assignee TEXT NOT NULL DEFAULT '',archived INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL,payload TEXT NOT NULL,operation TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(owner,id));
CREATE TABLE IF NOT EXISTS versions(owner TEXT NOT NULL,plan_id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(owner,plan_id,revision));
CREATE TABLE IF NOT EXISTS version_assets(owner TEXT NOT NULL,plan_id TEXT NOT NULL,revision INTEGER NOT NULL,blob_id TEXT NOT NULL,PRIMARY KEY(owner,plan_id,revision,blob_id),FOREIGN KEY(owner,plan_id,revision) REFERENCES versions(owner,plan_id,revision) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_version_blob ON version_assets(owner,blob_id);
CREATE INDEX IF NOT EXISTS idx_plans_updated ON plans(owner,updated);
