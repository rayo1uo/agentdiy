CREATE TABLE IF NOT EXISTS refresh_tokens (
  token VARCHAR(255) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_refresh_tokens_user_created ON refresh_tokens(user_id, created_at DESC);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
