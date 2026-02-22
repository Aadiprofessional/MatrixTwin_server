CREATE TABLE IF NOT EXISTS public.project_members ( 
   project_id uuid not null, 
   user_id uuid not null, 
   role text null default 'member'::text, 
   joined_at timestamp with time zone null default now(), 
   constraint project_members_pkey primary key (project_id, user_id), 
   constraint project_members_project_id_fkey foreign KEY (project_id) references projects (id) on delete CASCADE, 
   constraint project_members_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE 
 ) TABLESPACE pg_default;
