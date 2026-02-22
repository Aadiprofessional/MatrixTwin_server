-- Add unique company code to companies table
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS code TEXT UNIQUE;

-- Add function to generate random company code if not provided
CREATE OR REPLACE FUNCTION generate_company_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.code IS NULL THEN
    -- Generate a random 6-character alphanumeric code
    NEW.code := upper(substring(md5(random()::text), 1, 6));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically generate code on company creation
DROP TRIGGER IF EXISTS ensure_company_code ON companies;
CREATE TRIGGER ensure_company_code
BEFORE INSERT ON companies
FOR EACH ROW
EXECUTE FUNCTION generate_company_code();

-- Update existing companies with a code if they don't have one
UPDATE companies SET code = upper(substring(md5(random()::text), 1, 6)) WHERE code IS NULL;

-- Add company_id to users table to track membership
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

-- Create table for company join requests
CREATE TABLE IF NOT EXISTS company_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, user_id) -- Prevent duplicate requests
);

-- RLS Policies for company_join_requests

-- Enable RLS
ALTER TABLE company_join_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see their own requests
CREATE POLICY "Users can view own join requests" 
  ON company_join_requests FOR SELECT 
  USING (auth.uid() = user_id);

-- Policy: Users can create requests (if not already in a company - enforced by app logic too)
CREATE POLICY "Users can create join requests" 
  ON company_join_requests FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Policy: Company Admins (and Owners) can view requests for their company
-- We need to check if the current user is the admin of the company in the request
CREATE POLICY "Company Admins can view requests" 
  ON company_join_requests FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM companies 
      WHERE id = company_join_requests.company_id 
      AND (admin_id = auth.uid() OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'owner'))
    )
  );

-- Policy: Company Admins (and Owners) can update requests (approve/reject)
CREATE POLICY "Company Admins can update requests" 
  ON company_join_requests FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM companies 
      WHERE id = company_join_requests.company_id 
      AND (admin_id = auth.uid() OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'owner'))
    )
  );

-- Add policy to allow users to update their own company_id (only if they are joining? No, better to have admin do it or use a secure function)
-- Actually, we'll likely handle the approval via a secure endpoint where the admin updates the user record.
-- So we need to ensure Company Admins can update users who have requested to join.

-- Allow Company Admins to update users (specifically company_id)
-- This is tricky with RLS. It's better to have a SECURITY DEFINER function for approving requests.

CREATE OR REPLACE FUNCTION approve_join_request(request_id UUID)
RETURNS VOID AS $$
DECLARE
  v_company_id UUID;
  v_user_id UUID;
  v_requester_id UUID;
  v_is_admin BOOLEAN;
  v_is_owner BOOLEAN;
BEGIN
  -- Get request details
  SELECT company_id, user_id INTO v_company_id, v_user_id
  FROM company_join_requests
  WHERE id = request_id AND status = 'pending';

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or non-pending request';
  END IF;

  -- Check permissions (current user must be admin of company or owner)
  v_requester_id := auth.uid();
  
  SELECT EXISTS(SELECT 1 FROM companies WHERE id = v_company_id AND admin_id = v_requester_id) INTO v_is_admin;
  SELECT EXISTS(SELECT 1 FROM public.users WHERE id = v_requester_id AND role = 'owner') INTO v_is_owner;

  IF NOT (v_is_admin OR v_is_owner) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Update request status
  UPDATE company_join_requests 
  SET status = 'approved', updated_at = NOW() 
  WHERE id = request_id;

  -- Update user's company_id
  UPDATE public.users 
  SET company_id = v_company_id 
  WHERE id = v_user_id;

  -- Reject other pending requests for this user
  UPDATE company_join_requests
  SET status = 'rejected', updated_at = NOW()
  WHERE user_id = v_user_id AND id != request_id AND status = 'pending';

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
