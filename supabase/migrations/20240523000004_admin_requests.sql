-- Create admin_requests table with company details
CREATE TABLE IF NOT EXISTS public.admin_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NULL,
  status text NULL DEFAULT 'pending'::text,
  requested_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  company_name text NOT NULL,
  company_details jsonb NULL DEFAULT '{}'::jsonb,
  rejection_reason text NULL,
  CONSTRAINT admin_requests_pkey PRIMARY KEY (id),
  CONSTRAINT admin_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE,
  CONSTRAINT admin_requests_status_check CHECK (
    (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))
  )
);

-- Unique index for pending requests per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_requests_user_pending 
ON public.admin_requests USING btree (user_id) 
WHERE (status = 'pending'::text);

-- RPC Function to Approve Request (Transactional)
-- This function:
-- 1. Updates admin_requests status to 'approved'
-- 2. Creates a new company in 'companies' table
-- 3. Updates 'users' table (sets role='admin', company_id=new_company_id)
-- Returns the new company ID
CREATE OR REPLACE FUNCTION approve_admin_request_rpc(
  p_request_id UUID,
  p_approver_id UUID -- Passed for logging/audit if needed, currently unused
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

  -- 3. Update User (Role -> Admin, Company -> New Company)
  UPDATE users
  SET role = 'admin',
      company_id = v_new_company_id,
      updated_at = NOW()
  WHERE id = v_request.user_id
  RETURNING email INTO v_user_email;

  -- 4. Update Request Status
  UPDATE admin_requests
  SET status = 'approved',
      updated_at = NOW()
  WHERE id = p_request_id;

  RETURN v_new_company_id;
END;
$$;

-- RPC Function to Reject Request
CREATE OR REPLACE FUNCTION reject_admin_request_rpc(
  p_request_id UUID,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE admin_requests
  SET status = 'rejected',
      rejection_reason = p_reason,
      updated_at = NOW()
  WHERE id = p_request_id AND status = 'pending';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or already processed';
  END IF;
END;
$$;
