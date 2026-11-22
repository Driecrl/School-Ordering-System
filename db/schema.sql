CREATE TABLE IF NOT EXISTS accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_number VARCHAR(80) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  role ENUM('student', 'staff') NOT NULL,
  pin_hash VARCHAR(255) NOT NULL,
  must_change_pin BOOLEAN NOT NULL DEFAULT TRUE,
  pin_expires_at BIGINT UNSIGNED NULL,
  failed_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY accounts_account_number_uq (account_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menu_items (
  id VARCHAR(40) NOT NULL,
  name VARCHAR(150) NOT NULL,
  category ENUM('Meals', 'Snacks', 'Drinks') NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  price_cents INT UNSIGNED NOT NULL,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  status ENUM('Received', 'Preparing', 'Ready for pickup') NOT NULL DEFAULT 'Received',
  total_cents INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY orders_account_created_idx (account_id, created_at),
  KEY orders_status_created_idx (status, created_at),
  CONSTRAINT orders_account_fk FOREIGN KEY (account_id) REFERENCES accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  menu_item_id VARCHAR(40) NOT NULL,
  item_name VARCHAR(150) NOT NULL,
  quantity TINYINT UNSIGNED NOT NULL,
  unit_price_cents INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY order_items_order_idx (order_id),
  CONSTRAINT order_items_quantity_chk CHECK (quantity BETWEEN 1 AND 10),
  CONSTRAINT order_items_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT order_items_menu_fk FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS web_sessions (
  session_id VARCHAR(128) NOT NULL,
  expires_at BIGINT UNSIGNED NOT NULL,
  session_data MEDIUMTEXT NOT NULL,
  PRIMARY KEY (session_id),
  KEY web_sessions_expires_idx (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO menu_items (id, name, category, description, price_cents, available, display_order)
VALUES
  ('chicken', 'Chicken rice bowl', 'Meals', 'Grilled chicken with steamed rice', 9500, TRUE, 1),
  ('pancit', 'Pancit canton', 'Meals', 'Noodles with mixed vegetables', 6500, TRUE, 2),
  ('sandwich', 'Veggie sandwich', 'Snacks', 'Fresh vegetables on soft bread', 5500, TRUE, 3),
  ('turon', 'Turon', 'Snacks', 'Banana spring roll · 2 pieces', 3000, TRUE, 4),
  ('gulaman', 'Iced gulaman', 'Drinks', 'Chilled house-made drink', 2500, TRUE, 5),
  ('water', 'Bottled water', 'Drinks', 'Cold drinking water', 2000, TRUE, 6)
ON DUPLICATE KEY UPDATE id = VALUES(id);
