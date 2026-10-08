CREATE TABLE IF NOT EXISTS transfer_logs (
    session_id VARCHAR(64) PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL
);
