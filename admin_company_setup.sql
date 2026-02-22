-- 1. Create admin_requests table
CREATE TABLE IF NOT EXISTS public.admin_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure only one pending request per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_requests_user_pending ON public.admin_requests (user_id) WHERE status = 'pending';

-- 2. Create companies table
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  details JSONB DEFAULT '{}', -- Store address, contact, etc.
  admin_id UUID REFERENCES public.users(id) ON DELETE SET NULL, -- Assigned admin
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Enable RLS
ALTER TABLE public.admin_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for admin_requests
-- Users can see their own requests
CREATE POLICY "Users can view own admin requests" 
  ON public.admin_requests 
  FOR SELECT 
  USING (auth.uid() = user_id);

-- Users can create requests
CREATE POLICY "Users can create admin requests" 
  ON public.admin_requests 
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Owners can see all requests
CREATE POLICY "Owners can view all admin requests" 
  ON public.admin_requests 
  FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() AND role = 'owner'
    )
  );

-- Owners can update requests (approve/reject)
CREATE POLICY "Owners can update admin requests" 
  ON public.admin_requests 
  FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() AND role = 'owner'
    )
  );

-- 5. RLS Policies for companies
-- Owners can do everything with companies
CREATE POLICY "Owners can manage companies" 
  ON public.companies 
  FOR ALL 
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() AND role = 'owner'
    )
  );

-- Admins can view their assigned company
CREATE POLICY "Admins can view assigned company" 
  ON public.companies 
  FOR SELECT 
  USING (auth.uid() = admin_id);

-- 7. Allow Owners to update users (to promote them to admin)
CREATE POLICY "Owners can update user roles" 
  ON public.users 
  FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() AND role = 'owner'
    )
  );

-- 6. Add OWNER role to valid roles if using enum constraint (optional, but good practice if enforced)
-- Assuming role is just text, so no enum update needed for now.
