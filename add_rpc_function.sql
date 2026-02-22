-- Function to safely lookup company ID by code (bypassing RLS)
CREATE OR REPLACE FUNCTION get_company_by_code(company_code TEXT)
RETURNS UUID AS $$
DECLARE
  v_company_id UUID;
BEGIN
  SELECT id INTO v_company_id FROM companies WHERE code = company_code;
  RETURN v_company_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to safely lookup company ID by ID (bypassing RLS)
CREATE OR REPLACE FUNCTION get_company_by_id(comp_id UUID)
RETURNS UUID AS $$
DECLARE
  v_company_id UUID;
BEGIN
  SELECT id INTO v_company_id FROM companies WHERE id = comp_id;
  RETURN v_company_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create join request by code (for new users)
-- Renamed parameter p_user_id to avoid ambiguity with column name
CREATE OR REPLACE FUNCTION create_join_request_by_code(company_code TEXT, p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_company_id UUID;
BEGIN
  -- Get company ID (securely via definer)
  SELECT id INTO v_company_id FROM companies WHERE code = company_code;
  
  -- Insert request if company found and not already requested
  IF v_company_id IS NOT NULL THEN
    INSERT INTO company_join_requests (company_id, user_id, status)
    SELECT v_company_id, p_user_id, 'pending'
    WHERE NOT EXISTS (
        SELECT 1 FROM company_join_requests 
        WHERE company_id = v_company_id AND user_id = p_user_id
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
