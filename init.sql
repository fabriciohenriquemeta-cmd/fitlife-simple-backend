-- FitLife Pro - Simple Backend Database Schema
-- Execute this SQL in your PostgreSQL database

-- Drop tables if exist (careful in production!)
DROP TABLE IF EXISTS loads CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Loads table
CREATE TABLE loads (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exercise VARCHAR(255) NOT NULL,
    sets INTEGER NOT NULL,
    reps INTEGER NOT NULL,
    weight DECIMAL(6,2) NOT NULL,
    date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX idx_loads_user_id ON loads(user_id);
CREATE INDEX idx_loads_date ON loads(date);
CREATE INDEX idx_users_email ON users(email);

-- Insert sample data (optional - for testing)
-- INSERT INTO users (name, email, password) VALUES 
-- ('Teste Usuario', 'teste@gmail.com', '$2a$10$abcdefghijklmnopqrstuvwxyz123456');
