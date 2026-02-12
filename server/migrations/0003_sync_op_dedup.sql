ALTER TABLE sync_events
  ADD COLUMN op_id VARCHAR(128) NOT NULL DEFAULT '' AFTER device_id;

CREATE UNIQUE INDEX ux_sync_events_user_device_op ON sync_events(user_id, device_id, op_id);
CREATE INDEX idx_sync_events_user_cursor ON sync_events(user_id, id);
