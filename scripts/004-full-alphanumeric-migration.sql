-- Update all tables to use alphanumeric IDs

-- Add alphanumeric IDs to all tables
ALTER TABLE vendors ADD COLUMN alphanumeric_id VARCHAR(6) UNIQUE;
ALTER TABLE affiliates ADD COLUMN alphanumeric_id VARCHAR(6) UNIQUE;
ALTER TABLE products ADD COLUMN alphanumeric_id VARCHAR(8) UNIQUE;
ALTER TABLE affiliate_applications ADD COLUMN alphanumeric_id VARCHAR(8) UNIQUE;
ALTER TABLE affiliate_links ADD COLUMN alphanumeric_id VARCHAR(8) UNIQUE;
ALTER TABLE transactions ADD COLUMN alphanumeric_id VARCHAR(8) UNIQUE;
ALTER TABLE product_resources ADD COLUMN alphanumeric_id VARCHAR(8) UNIQUE;
ALTER TABLE user_bank_accounts ADD COLUMN alphanumeric_id VARCHAR(8) UNIQUE;
ALTER TABLE withdrawal_requests ADD COLUMN alphanumeric_id VARCHAR(8) UNIQUE;
ALTER TABLE product_advertisements ADD COLUMN alphanumeric_id VARCHAR(8) UNIQUE;
ALTER TABLE receipts ADD COLUMN alphanumeric_id VARCHAR(8) UNIQUE;

-- Generate alphanumeric IDs for existing records
UPDATE vendors SET alphanumeric_id = generate_alphanumeric_id() WHERE alphanumeric_id IS NULL;
UPDATE affiliates SET alphanumeric_id = generate_alphanumeric_id() WHERE alphanumeric_id IS NULL;

-- For 8-character IDs, create a new function
CREATE OR REPLACE FUNCTION generate_long_alphanumeric_id()
RETURNS VARCHAR(8) AS $$
DECLARE
  chars VARCHAR(36) := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result VARCHAR(8) := '';
  i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Generate 8-character IDs for other tables
UPDATE products SET alphanumeric_id = generate_long_alphanumeric_id() WHERE alphanumeric_id IS NULL;
UPDATE affiliate_applications SET alphanumeric_id = generate_long_alphanumeric_id() WHERE alphanumeric_id IS NULL;
UPDATE affiliate_links SET alphanumeric_id = generate_long_alphanumeric_id() WHERE alphanumeric_id IS NULL;
UPDATE transactions SET alphanumeric_id = generate_long_alphanumeric_id() WHERE alphanumeric_id IS NULL;
UPDATE product_resources SET alphanumeric_id = generate_long_alphanumeric_id() WHERE alphanumeric_id IS NULL;
UPDATE user_bank_accounts SET alphanumeric_id = generate_long_alphanumeric_id() WHERE alphanumeric_id IS NULL;
UPDATE withdrawal_requests SET alphanumeric_id = generate_long_alphanumeric_id() WHERE alphanumeric_id IS NULL;
UPDATE product_advertisements SET alphanumeric_id = generate_long_alphanumeric_id() WHERE alphanumeric_id IS NULL;
UPDATE receipts SET alphanumeric_id = generate_long_alphanumeric_id() WHERE alphanumeric_id IS NULL;

-- Make alphanumeric_id NOT NULL for future records
ALTER TABLE vendors ALTER COLUMN alphanumeric_id SET NOT NULL;
ALTER TABLE affiliates ALTER COLUMN alphanumeric_id SET NOT NULL;
ALTER TABLE products ALTER COLUMN alphanumeric_id SET NOT NULL;
ALTER TABLE affiliate_applications ALTER COLUMN alphanumeric_id SET NOT NULL;
ALTER TABLE affiliate_links ALTER COLUMN alphanumeric_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN alphanumeric_id SET NOT NULL;
ALTER TABLE product_resources ALTER COLUMN alphanumeric_id SET NOT NULL;
ALTER TABLE user_bank_accounts ALTER COLUMN alphanumeric_id SET NOT NULL;
ALTER TABLE withdrawal_requests ALTER COLUMN alphanumeric_id SET NOT NULL;
ALTER TABLE product_advertisements ALTER COLUMN alphanumeric_id SET NOT NULL;
ALTER TABLE receipts ALTER COLUMN alphanumeric_id SET NOT NULL;

-- Update tracking codes to be alphanumeric
UPDATE affiliate_links SET tracking_code = 
  UPPER(SUBSTRING(MD5(RANDOM()::TEXT), 1, 10)) 
WHERE tracking_code ~ '^[0-9]+$' OR tracking_code IS NULL;

-- Create function to generate tracking codes
CREATE OR REPLACE FUNCTION generate_tracking_code()
RETURNS VARCHAR(10) AS $$
DECLARE
  chars VARCHAR(36) := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result VARCHAR(10) := '';
  i INTEGER;
BEGIN
  FOR i IN 1..10 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Update receipt number generation to use alphanumeric
CREATE OR REPLACE FUNCTION generate_receipt_number()
RETURNS VARCHAR(50) AS $$
DECLARE
  new_number VARCHAR(50);
  counter VARCHAR(6);
BEGIN
  -- Generate 6-character alphanumeric counter
  counter := generate_alphanumeric_id();
  new_number := 'AFF' || TO_CHAR(CURRENT_DATE, 'YYYY') || counter;
  RETURN new_number;
END;
$$ LANGUAGE plpgsql;
