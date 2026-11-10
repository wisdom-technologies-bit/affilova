-- Create rate limiting table for OTP requests
CREATE TABLE IF NOT EXISTS otp_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email character varying NOT NULL,
  ip_address character varying NOT NULL,
  request_count integer DEFAULT 1,
  last_request_at timestamp without time zone DEFAULT NOW(),
  created_at timestamp without time zone DEFAULT NOW(),
  expires_at timestamp without time zone DEFAULT (NOW() + interval '15 minutes'),
  UNIQUE(email, ip_address)
);

-- Create IP-based rate limiting for general auth requests
CREATE TABLE IF NOT EXISTS ip_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address character varying NOT NULL,
  request_type character varying NOT NULL,
  request_count integer DEFAULT 1,
  last_request_at timestamp without time zone DEFAULT NOW(),
  created_at timestamp without time zone DEFAULT NOW(),
  expires_at timestamp without time zone DEFAULT (NOW() + interval '10 minutes'),
  UNIQUE(ip_address, request_type)
);

-- Create security audit log
CREATE TABLE IF NOT EXISTS security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type character varying NOT NULL,
  email character varying,
  ip_address character varying,
  user_agent text,
  details jsonb,
  success boolean,
  created_at timestamp without time zone DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_otp_rate_limits_email_expires ON otp_rate_limits(email, expires_at);
CREATE INDEX IF NOT EXISTS idx_otp_rate_limits_ip_expires ON otp_rate_limits(ip_address, expires_at);
CREATE INDEX IF NOT EXISTS idx_ip_rate_limits_expires ON ip_rate_limits(ip_address, expires_at);
CREATE INDEX IF NOT EXISTS idx_security_audit_created ON security_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_security_audit_email ON security_audit_log(email);
