-- Migration: Add NUR team support
-- Adds api_key_nur and profile_id_nur columns to users table

ALTER TABLE users ADD COLUMN api_key_nur TEXT NOT NULL DEFAULT '-';
ALTER TABLE users ADD COLUMN profile_id_nur TEXT NOT NULL DEFAULT '-';
