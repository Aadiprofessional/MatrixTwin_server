-- Create company_members table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.company_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member', -- 'admin', 'member', etc.
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(company_id, user_id) -- Ensure one user per company (redundant if checking globally, but good for table integrity)
);

-- Enable RLS
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Members can view members of their own company
CREATE POLICY "Members can view company members"
    ON public.company_members FOR SELECT
    USING (
        company_id IN (
            SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
        )
    );

-- Admins/Owners can manage members
CREATE POLICY "Admins can manage company members"
    ON public.company_members FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.company_members 
            WHERE user_id = auth.uid() AND company_id = public.company_members.company_id AND role = 'admin'
        ) OR EXISTS (
            SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'owner'
        )
    );

-- Trigger to enforce 1 user = 1 company globally
-- We can use a unique constraint on user_id in company_members, but if we want to allow history, we might not.
-- However, the requirement is "1 user can join only 1 company".
-- So a unique index on user_id is the best way to enforce this at DB level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_company_per_user ON public.company_members(user_id);

-- Update create_company to add admin as member
CREATE OR REPLACE FUNCTION add_admin_to_company_members()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert the admin into company_members
    IF NEW.admin_id IS NOT NULL THEN
        INSERT INTO public.company_members (company_id, user_id, role)
        VALUES (NEW.id, NEW.admin_id, 'admin')
        ON CONFLICT (user_id) DO UPDATE SET company_id = NEW.id, role = 'admin'; 
        -- If they were in another company, this moves them. 
        -- But requirement says "1 admin assign to it".
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_company_created_add_member ON public.companies;
CREATE TRIGGER on_company_created_add_member
AFTER INSERT ON public.companies
FOR EACH ROW
EXECUTE FUNCTION add_admin_to_company_members();

-- Update approve_join_request to add user to company_members
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
  
  -- Check if requester is admin in company_members
  SELECT EXISTS(
      SELECT 1 FROM company_members 
      WHERE company_id = v_company_id AND user_id = v_requester_id AND role = 'admin'
  ) INTO v_is_admin;
  
  -- Fallback: Check if requester is owner in users table
  SELECT EXISTS(SELECT 1 FROM public.users WHERE id = v_requester_id AND role = 'owner') INTO v_is_owner;

  -- Also check legacy admin_id column in companies if needed (for backward compat)
  IF NOT v_is_admin THEN
      SELECT EXISTS(SELECT 1 FROM companies WHERE id = v_company_id AND admin_id = v_requester_id) INTO v_is_admin;
  END IF;

  IF NOT (v_is_admin OR v_is_owner) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Update request status
  UPDATE company_join_requests 
  SET status = 'approved', updated_at = NOW() 
  WHERE id = request_id;

  -- Add user to company_members
  INSERT INTO public.company_members (company_id, user_id, role)
  VALUES (v_company_id, v_user_id, 'member')
  ON CONFLICT (user_id) DO UPDATE SET company_id = v_company_id, role = 'member';

  -- Update legacy company_id in users table (optional, but keeping for compatibility)
  UPDATE public.users 
  SET company_id = v_company_id 
  WHERE id = v_user_id;

  -- Reject other pending requests for this user
  UPDATE company_join_requests
  SET status = 'rejected', updated_at = NOW()
  WHERE user_id = v_user_id AND id != request_id AND status = 'pending';

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
