-- Fix approve_admin_request_rpc to insert into company_members
CREATE OR REPLACE FUNCTION approve_admin_request_rpc(
  p_request_id UUID,
  p_approver_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request RECORD;
  v_new_company_id UUID;
  v_user_email TEXT;
BEGIN
  -- 1. Fetch Request
  SELECT * INTO v_request 
  FROM admin_requests 
  WHERE id = p_request_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or already processed';
  END IF;

  -- 2. Create Company
  INSERT INTO companies (name, details, admin_id, created_by)
  VALUES (v_request.company_name, v_request.company_details, v_request.user_id, v_request.user_id)
  RETURNING id INTO v_new_company_id;

  -- 3. Add to company_members (The Fix)
  INSERT INTO company_members (company_id, user_id, role)
  VALUES (v_new_company_id, v_request.user_id, 'admin');

  -- 4. Update User (Role -> Admin, Company -> New Company)
  UPDATE users
  SET role = 'admin',
      company_id = v_new_company_id,
      updated_at = NOW()
  WHERE id = v_request.user_id
  RETURNING email INTO v_user_email;

  -- 5. Update Request Status
  UPDATE admin_requests
  SET status = 'approved',
      updated_at = NOW()
  WHERE id = p_request_id;

  RETURN v_new_company_id;
END;
$$;

-- Backfill missing admins into company_members
INSERT INTO company_members (company_id, user_id, role)
SELECT id, admin_id, 'admin'
FROM companies
WHERE admin_id IS NOT NULL
ON CONFLICT (company_id, user_id) DO NOTHING;
