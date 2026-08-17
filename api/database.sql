CREATE DATABASE IF NOT EXISTS iptv_player CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE iptv_player;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    email VARCHAR(150) DEFAULT NULL,
    xtream_username VARCHAR(100) DEFAULT NULL,
    xtream_password VARCHAR(255) DEFAULT NULL,
    playlist_url TEXT,
    session_token VARCHAR(128) DEFAULT NULL,
    active TINYINT(1) DEFAULT 1,
    expiration_date DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME DEFAULT NULL,
    last_activity DATETIME DEFAULT NULL,
    is_playing TINYINT(1) DEFAULT 0,
    current_channel TEXT,
    max_connections INT DEFAULT 1,
    INDEX idx_username (username),
    INDEX idx_session (session_token),
    INDEX idx_active (active)
);

CREATE TABLE IF NOT EXISTS user_activity (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    channel_name VARCHAR(255) DEFAULT NULL,
    channel_url TEXT,
    start_time DATETIME DEFAULT NULL,
    last_update DATETIME DEFAULT NULL,
    is_active TINYINT(1) DEFAULT 1,
    force_stop TINYINT(1) DEFAULT 0,
    UNIQUE KEY uniq_username (username),
    INDEX idx_active_update (is_active, last_update)
);

CREATE TABLE IF NOT EXISTS blocked_users (
    username VARCHAR(100) PRIMARY KEY,
    blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playback_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT DEFAULT NULL,
    username VARCHAR(100) DEFAULT NULL,
    channel_name VARCHAR(255),
    channel_url TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
