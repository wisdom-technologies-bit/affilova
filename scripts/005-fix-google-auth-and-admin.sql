-- Allow null password_hash for Google OAuth users
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Insert admin user (wisdommeremeze@gmail.com)
INSERT INTO users (
  alphanumeric_id, email, password_hash, role, first_name, last_name, 
  is_verified, is_active, has_password, onboarding_completed
) VALUES (
  'ADMIN1', 'wisdommeremeze@gmail.com', 
  '$2a$12$LQv3c1yqBwEHXjw9cnbCNOSeaTEQdRwpb6A5dJiggAPS28ksnX6yG', -- password: admin123
  'admin', 'Wisdom', 'Meremeze', 
  true, true, true, true
) ON CONFLICT (email) DO UPDATE SET
  role = 'admin',
  is_verified = true,
  is_active = true,
  onboarding_completed = true;

-- Create OTP verification table
CREATE TABLE IF NOT EXISTS otp_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  otp_code VARCHAR(6) NOT NULL,
  otp_type VARCHAR(20) NOT NULL CHECK (otp_type IN ('registration', 'login', 'password_reset')),
  expires_at TIMESTAMP NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for OTP table
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_verifications(email);
CREATE INDEX IF NOT EXISTS idx_otp_code ON otp_verifications(otp_code);
CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_verifications(expires_at);

-- Function to generate 6-digit OTP
CREATE OR REPLACE FUNCTION generate_otp()
RETURNS VARCHAR(6) AS $$
BEGIN
  RETURN LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Clean up expired OTPs (run periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_otps()
RETURNS VOID AS $$
BEGIN
  DELETE FROM otp_verifications WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
