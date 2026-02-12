CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS devices (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  device_name VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS documents (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT,
  title TEXT,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_documents_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS annotations (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  document_id CHAR(36) NOT NULL,
  quote_text TEXT NOT NULL,
  prefix_text TEXT,
  suffix_text TEXT,
  start_offset INT NOT NULL,
  end_offset INT NOT NULL,
  color VARCHAR(20) NOT NULL,
  comment_text TEXT,
  status ENUM('active', 'deleted') NOT NULL DEFAULT 'active',
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_annotations_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_annotations_document FOREIGN KEY (document_id) REFERENCES documents(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sync_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  device_id CHAR(36) NOT NULL,
  annotation_id CHAR(36) NOT NULL,
  op_type VARCHAR(32) NOT NULL,
  payload_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_sync_events_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_sync_events_device FOREIGN KEY (device_id) REFERENCES devices(id),
  CONSTRAINT fk_sync_events_annotation FOREIGN KEY (annotation_id) REFERENCES annotations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_annotations_user_doc_updated ON annotations(user_id, document_id, updated_at DESC);
CREATE INDEX idx_annotations_user_status_updated ON annotations(user_id, status, updated_at DESC);
CREATE INDEX idx_sync_events_user_id ON sync_events(user_id, id);
