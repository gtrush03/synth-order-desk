CREATE TABLE visitors (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 role TEXT NOT NULL, interest TEXT NOT NULL, directory_consent INTEGER NOT NULL CHECK(directory_consent IN(0,1)),
 followup_consent INTEGER NOT NULL CHECK(followup_consent IN(0,1)),
 consent_version TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 ip_hash TEXT NOT NULL, manage_hash TEXT NOT NULL, withdrawn_at INTEGER
);
CREATE INDEX visitor_public ON visitors(directory_consent, withdrawn_at, expires_at);
CREATE INDEX visitor_rate ON visitors(ip_hash,created_at);
CREATE TABLE mail_attempts (
 id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL UNIQUE, day TEXT NOT NULL,
 preview_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('reserved','accepted','uncertain')),
 provider_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX mail_day ON mail_attempts(day);
