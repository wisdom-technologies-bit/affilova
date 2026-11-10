-- Remove onboarding-related columns and ensure profile picture consistency
ALTER TABLE users DROP COLUMN IF EXISTS onboarding_completed;

-- Ensure we have a single profile_picture_url column
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;

-- Update any existing profile pictures from Google auth
UPDATE users 
SET profile_picture_url = COALESCE(profile_picture_url, '')
WHERE profile_picture_url IS NULL;

-- Add role selection timestamp
ALTER TABLE users ADD COLUMN IF EXISTS role_selected_at TIMESTAMP;
