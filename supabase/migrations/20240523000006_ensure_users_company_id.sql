-- Add company_id to users table if not exists
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;

-- Add index on company_id for performance
CREATE INDEX IF NOT EXISTS idx_users_company_id ON public.users(company_id);
