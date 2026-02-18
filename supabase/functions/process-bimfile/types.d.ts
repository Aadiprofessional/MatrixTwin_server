// Type declarations for Deno and ESM modules used in the edge function

declare module 'https://deno.land/std@0.177.0/http/server.ts' {
  export function serve(handler: (req: Request) => Response | Promise<Response>): void;
}

declare module 'https://esm.sh/@supabase/supabase-js@2.29.0' {
  export function createClient(url: string, key: string, options?: any): any;
}

// Deno namespace declaration
declare namespace Deno {
  export interface Env {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    toObject(): { [key: string]: string };
  }
  
  export const env: Env;
}

// Extended interface for process status
interface ProcessStatus {
  status: string;
  step: string;
  progress: number;
  error?: string;
  file_id?: number;
  project_id?: string | null;
  token?: string;
} 