-- Create company_join_requests table
CREATE TABLE IF NOT EXISTS public.company_join_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  CONSTRAINT company_join_requests_pkey PRIMARY KEY (id),
  CONSTRAINT company_join_requests_company_id_user_id_key UNIQUE (company_id, user_id),
  CONSTRAINT company_join_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT company_join_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE,
  CONSTRAINT company_join_requests_status_check CHECK (
    (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))
  )
);

-- Create company_members table if not exists (it might already exist from previous migrations)
CREATE TABLE IF NOT EXISTS public.company_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member'::text,
  joined_at timestamp with time zone NULL DEFAULT now(),
  CONSTRAINT company_members_pkey PRIMARY KEY (id),
  CONSTRAINT company_members_company_id_user_id_key UNIQUE (company_id, user_id),
  CONSTRAINT company_members_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT company_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE
);

-- Ensure index exists for one company per user rule
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_company_per_user 
ON public.company_members USING btree (user_id);

-- RPC Function to Approve Join Request
CREATE OR REPLACE FUNCTION approve_company_join_request_rpc(
  p_request_id UUID,
  p_approver_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request RECORD;
BEGIN
  -- 1. Fetch Request
  SELECT * INTO v_request 
  FROM company_join_requests 
  WHERE id = p_request_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or already processed';
  END IF;

  -- 2. Add to company_members
  INSERT INTO company_members (company_id, user_id, role)
  VALUES (v_request.company_id, v_request.user_id, 'member');

  -- 3. Update User's company_id
  UPDATE users
  SET company_id = v_request.company_id,
      updated_at = NOW()
  WHERE id = v_request.user_id;

  -- 4. Update Request Status
  UPDATE company_join_requests
  SET status = 'approved',
      updated_at = NOW()
  WHERE id = p_request_id;
END;
$$;

-- RPC Function to Remove Member
CREATE OR REPLACE FUNCTION remove_company_member_rpc(
  p_user_id UUID,
  p_company_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Remove from company_members
  DELETE FROM company_members
  WHERE user_id = p_user_id AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found in this company';
  END IF;

  -- 2. Update User's company_id to NULL
  UPDATE users
  SET company_id = NULL,
      updated_at = NOW()
  WHERE id = p_user_id;
END;
$$;
