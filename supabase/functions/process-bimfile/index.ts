import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.29.0';

interface RequestBody {
  userId: string;
  fileName: string;
  fileData: string; // Base64 encoded file data
  testMode?: boolean;
}

interface BimfaceCredentials {
  appKey: string;
  appSecret: string;
}

interface TokenResponse {
  code: string;
  message: string | null;
  data: {
    expireTime: string;
    token: string;
  } | null;
}

interface TranslateResponse {
  code: string;
  message: string | null;
  data: {
    fileId: number;
    status: string;
    [key: string]: any;
  } | null;
}

// Define type for the process status
interface ProcessStatus {
  status: string;
  step: string;
  progress: number;
  error?: string;
  file_id?: number;
  project_id?: string | null;
  token?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// BIMFace credentials
const BIMFACE_CREDENTIALS: BimfaceCredentials = {
  appKey: 'rHue4iORWkUqAAee4Maj5oAOv8byfRiN',
  appSecret: 'S76cdgQlT1pZg14EvYzPAHRjERsX8qVU',
};

// Direct Supabase details
const SUPABASE_URL = 'https://ahtardktcamfwgjuwmeb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFodGFyZGt0Y2FtZndnanV3bWViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUzMTI5ODIsImV4cCI6MjA2MDg4ODk4Mn0.9yk6uUEpX-eIHTziSlG9nTDmKb2LRR0YY_P0pH6A_lc';

// Helper function for logging
function logStep(step: string, details?: any) {
  console.log("-------------------------------------------");
  console.log(`✅ STEP: ${step}`);
  if (details) {
    console.log(JSON.stringify(details, null, 2));
  }
  console.log("-------------------------------------------");
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    logStep('CORS Preflight Request');
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    logStep('Request Received', { 
      method: req.method,
      url: req.url
    });

    const supabaseClient = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );
    logStep('Supabase Client Created');

    // Only accept POST requests
    if (req.method !== 'POST') {
      logStep('Method Not Allowed', { method: req.method });
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse request body
    const requestBody = await req.text();
    logStep('Request Body Received', { bodyLength: requestBody.length });
    
    const { userId, fileName, fileData, testMode } = JSON.parse(requestBody) as RequestBody;
    logStep('Request Parsed', { userId, fileName, fileDataLength: fileData?.length || 0, testMode });

    if (!userId || !fileName || !fileData) {
      logStep('Missing Required Fields', { userId, fileName, hasFileData: !!fileData });
      return new Response(
        JSON.stringify({ error: 'Missing required fields: userId, fileName, or fileData' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let userData: any = null;
    let logId: string = 'test-log-id';
    
    // Only check user and create log entry if not in test mode
    if (!testMode) {
      // Get user information from database
      logStep('Fetching User Data', { userId });
      try {
        const { data, error } = await supabaseClient
          .from('users')
          .select('id, name')
          .eq('id', userId)
          .single();

        if (error || !data) {
          logStep('User Not Found', { error });
          return new Response(JSON.stringify({ error: 'User not found', details: error }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
        userData = data;
        logStep('User Found', { userData });

        // Create a new log entry for processing
        logStep('Creating Log Entry', { userId, fileName });
        const { data: logData, error: logError } = await supabaseClient
          .from('bim_process_logs')
          .insert({
            user_id: userId,
            file_name: fileName,
            status: 'started',
            user_name: userData.name,
            progress: 0,
          })
          .select()
          .single();

        if (logError) {
          logStep('Log Entry Creation Failed', { error: logError });
          return new Response(JSON.stringify({ error: 'Failed to create log entry', details: logError }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
        logStep('Log Entry Created', { logId: logData.id });
        logId = logData.id;
      } catch (error) {
        logStep('Database Operation Error', { error: error.message });
        if (testMode) {
          logStep('Continuing In Test Mode Despite Error');
        } else {
          return new Response(JSON.stringify({ error: 'Database operation failed', details: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    } else {
      // In test mode, use dummy user data
      userData = { id: userId, name: 'Test User' };
      logStep('Test Mode Active', { userData });
    }

    // Step 1: Generate BIMFace token
    let processStatus: ProcessStatus = { status: 'processing', step: 'token_generation', progress: 5 };
    if (!testMode) {
      await updateLogStatus(supabaseClient, logId, processStatus);
    }
    logStep('🔑 STEP 1: Generating BIMFace Token');

    // Adding a cache-busting timestamp to ensure a fresh token each time
    const timestamp = new Date().getTime();
    const tokenResponse = await generateBimfaceToken(BIMFACE_CREDENTIALS, timestamp);
    
    logStep('Token Response Received', { 
      code: tokenResponse.code,
      hasToken: !!tokenResponse.data?.token,
      message: tokenResponse.message,
      timestamp
    });
    
    if (tokenResponse.code !== 'success' || !tokenResponse.data?.token) {
      processStatus = { status: 'failed', step: 'token_generation', progress: 5, error: 'Failed to generate token' };
      if (!testMode) {
        await updateLogStatus(supabaseClient, logId, processStatus);
      }
      logStep('Token Generation Failed', tokenResponse);
      
      return new Response(JSON.stringify({ 
        error: 'Failed to generate BIMFace token',
        details: tokenResponse 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = tokenResponse.data.token;
    logStep('✅ TOKEN GENERATED SUCCESSFULLY', { 
      token: token,
      expireTime: tokenResponse.data.expireTime,
      timestamp
    });
    
    // Step 2: Upload the file to Supabase Storage to get a URL
    processStatus = { status: 'processing', step: 'uploading_to_storage', progress: 40 };
    if (!testMode) {
      await updateLogStatus(supabaseClient, logId, processStatus);
    }
    
    logStep('🔄 STEP 2: Uploading file to Supabase Storage', { fileName });
    
    // Create a UUID for the file
    const fileUuid = crypto.randomUUID();
    const filePath = `bim_files/${userId}/${fileUuid}-${fileName}`;
    
    try {
      // Decode base64 for upload
      const binaryData = atob(fileData);
      const bytes = new Uint8Array(binaryData.length);
      for (let i = 0; i < binaryData.length; i++) {
        bytes[i] = binaryData.charCodeAt(i);
      }
      
      // Upload to Supabase Storage
      const { data: storageData, error: storageError } = await supabaseClient
        .storage
        .from('bim_files')
        .upload(filePath, bytes, {
          contentType: 'application/octet-stream',
          upsert: true
        });
      
      if (storageError) {
        logStep('Storage Upload Failed', { error: storageError });
        processStatus = { status: 'failed', step: 'uploading_to_storage', progress: 40, error: 'Failed to upload to storage' };
        if (!testMode) {
          await updateLogStatus(supabaseClient, logId, processStatus);
        }
        
        return new Response(JSON.stringify({ 
          error: 'Failed to upload file to storage',
          details: storageError
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      logStep('File Uploaded to Storage', { 
        path: storageData.path,
        fullPath: filePath 
      });
      
      // Get the public URL
      const { data: publicUrlData } = supabaseClient
        .storage
        .from('bim_files')
        .getPublicUrl(filePath);
      
      const fileUrl = publicUrlData.publicUrl;
      logStep('File Public URL Generated', { fileUrl });
      
      // Step 3: Send to BIMFace for processing
      processStatus = { status: 'processing', step: 'processing_with_bimface', progress: 70 };
      if (!testMode) {
        await updateLogStatus(supabaseClient, logId, processStatus);
      }
      
      logStep('🔄 STEP 3: Processing file with BIMFace', { fileUrl });
      
      const bimfaceResponse = await processBimFile(token, fileName, fileUrl);
      logStep('BIMFace Response Received', bimfaceResponse);
      
      if (!bimfaceResponse.success || !bimfaceResponse.fileId) {
        processStatus = { status: 'failed', step: 'processing_with_bimface', progress: 70, error: 'Failed to process file with BIMFace' };
        if (!testMode) {
          await updateLogStatus(supabaseClient, logId, processStatus);
        }
        
        return new Response(JSON.stringify({ 
          error: 'Failed to process file with BIMFace',
          details: bimfaceResponse
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      const fileId = bimfaceResponse.fileId;
      const projectId = bimfaceResponse.projectId || null;
      
      // Update database with success 
      processStatus = { 
        status: 'completed', 
        step: 'completed', 
        progress: 100,
        file_id: fileId,
        project_id: projectId,
        token: token
      };
      if (!testMode) {
        await updateLogStatus(supabaseClient, logId, processStatus);
      }
      logStep('✅ PROCESS COMPLETED SUCCESSFULLY', { 
        fileId, 
        projectId,
        fileUrl,
        status: 'processing'
      });
      
      // Return success response
      return new Response(JSON.stringify({
        success: true,
        message: 'File processed successfully',
        data: {
          logId: logId,
          fileId: fileId,
          projectId: projectId,
          fileUrl: fileUrl,
          token: token,
          status: 'processing'
        }
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      
    } catch (error) {
      logStep('File Processing Error', { message: error.message, stack: error.stack });
      
      processStatus = { status: 'failed', step: 'processing', progress: 40, error: error.message };
      if (!testMode) {
        await updateLogStatus(supabaseClient, logId, processStatus);
      }
      
      return new Response(JSON.stringify({ 
        error: 'Failed to process file',
        details: error.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    console.error('Unhandled error:', error);
    logStep('❌ UNHANDLED ERROR', { message: error.message, stack: error.stack });
    
    return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Helper function to update log status
async function updateLogStatus(supabaseClient: any, logId: string, statusData: ProcessStatus) {
  logStep('Updating Log Status', { logId, statusData });
  try {
    const { error } = await supabaseClient
      .from('bim_process_logs')
      .update({
        status: statusData.status,
        step: statusData.step,
        progress: statusData.progress,
        error: statusData.error,
        file_id: statusData.file_id,
        project_id: statusData.project_id,
        token: statusData.token
      })
      .eq('id', logId);
    
    if (error) {
      logStep('Log Status Update Failed', { error });
      console.error('Failed to update log status:', error);
    } else {
      logStep('Log Status Updated', { logId, status: statusData.status });
    }
  } catch (error) {
    logStep('Log Status Update Error', { message: error.message });
    console.error('Error updating log status:', error);
  }
}

// Function to generate BIMFace token with timestamp to prevent caching
async function generateBimfaceToken(credentials: BimfaceCredentials, timestamp?: number): Promise<TokenResponse> {
  try {
    // Add timestamp to request to prevent response caching
    const cacheBuster = timestamp || new Date().getTime();
    logStep('Generating Token Started', { appKey: credentials.appKey, timestamp: cacheBuster });
    
    const response = await fetch(`https://api.bimface.com/oauth2/token?_t=${cacheBuster}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${credentials.appKey}:${credentials.appSecret}`)}`,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      },
      body: 'grant_type=client_credentials'
    });
    
    logStep('Token API Response', { 
      status: response.status, 
      statusText: response.statusText
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return { 
        code: 'error', 
        message: `HTTP error ${response.status}: ${errorText}`, 
        data: null 
      };
    }
    
    const data = await response.json();
    logStep('Token Data Received', data);
    
    // BIMFace API returns a structure with code, message, and data
    // The data object contains the token and expireTime
    if (data.code === 'success' && data.data && data.data.token) {
      return data as TokenResponse; // Already in the correct format
    } else if (data.access_token) {
      // If for some reason we get the OAuth2 standard format
      return {
        code: 'success',
        message: null,
        data: {
          token: data.access_token,
          expireTime: new Date(Date.now() + (data.expires_in * 1000)).toISOString()
        }
      };
    } else {
      return {
        code: 'error',
        message: data.message || data.error_description || 'No token received',
        data: null
      };
    }
  } catch (error) {
    logStep('Token Generation Error', { message: error.message, stack: error.stack });
    console.error('Error generating token:', error);
    return { code: 'error', message: error.message, data: null };
  }
}

// Function to process the BIM file using BIMFace's translation API
async function processBimFile(token: string, fileName: string, fileUrl: string): Promise<any> {
  try {
    logStep('Processing BIM File Started', { fileName, fileUrl });
    
    // Using direct translation with BIMFace
    const response = await fetch('https://api.bimface.com/translate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: {
          url: fileUrl,
          name: fileName
        },
        config: {
          toBimtiles: true
        }
      })
    });
    
    logStep('BIMFace API Response', { 
      status: response.status, 
      statusText: response.statusText
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      try {
        return { 
          success: false, 
          error: `HTTP error ${response.status}: ${JSON.parse(errorText)}` 
        };
      } catch {
        return { 
          success: false, 
          error: `HTTP error ${response.status}: ${errorText}` 
        };
      }
    }
    
    const data = await response.json();
    logStep('BIMFace Response Data', data);
    
    // Check for fileId in the response
    if (data.fileId) {
      return {
        success: true,
        fileId: data.fileId,
        projectId: data.projectId || null,
        status: data.status || 'processing',
        message: 'File sent to BIMFace for processing'
      };
    } else {
      return {
        success: false,
        error: 'No fileId returned from BIMFace',
        data: data
      };
    }
  } catch (error) {
    logStep('BIMFace Processing Error', { message: error.message, stack: error.stack });
    console.error('Error processing with BIMFace:', error);
    return { success: false, error: error.message };
  }
} 