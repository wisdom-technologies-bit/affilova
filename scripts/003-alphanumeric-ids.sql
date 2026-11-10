-- Create function to generate 6-character alphanumeric IDs
CREATE OR REPLACE FUNCTION generate_alphanumeric_id()
RETURNS VARCHAR(6) AS $$
DECLARE
  chars VARCHAR(36) := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result VARCHAR(6) := '';
  i INTEGER;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Add password reset tokens table
CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(6) NOT NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for password reset tokens
CREATE INDEX idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_tokens_expires ON password_reset_tokens(expires_at);

-- Update users table to use alphanumeric IDs (for new users)
-- Note: This will only affect new users. Existing users keep their UUIDs for compatibility
ALTER TABLE users ADD COLUMN alphanumeric_id VARCHAR(6) UNIQUE;

-- Generate alphanumeric IDs for existing users
UPDATE users SET alphanumeric_id = generate_alphanumeric_id() WHERE alphanumeric_id IS NULL;

-- Make alphanumeric_id NOT NULL for future records
ALTER TABLE users ALTER COLUMN alphanumeric_id SET NOT NULL;

-- Add foreign key constraint for password reset tokens
ALTER TABLE password_reset_tokens ADD CONSTRAINT fk_password_reset_user 
  FOREIGN KEY (user_id) REFERENCES users(alphanumeric_id) ON DELETE CASCADE;
