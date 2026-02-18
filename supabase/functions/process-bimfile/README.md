# BIMFACE File Processing API

This Supabase Edge Function processes files using the BIMFACE API. It performs the following steps:
1. Generates a BIMFACE API token
2. Downloads a file from a provided URL
3. Uploads the file to BIMFACE
4. Translates the file for viewing in BIMFACE
5. Stores the processing details in the database

## Prerequisites

- Supabase project
- Deno runtime (automatically provided by Supabase Edge Functions)
- BIMFACE API credentials (already configured in the code)

## Request Format

The API accepts a POST request with the following JSON body:

```json
{
  "userId": "the-user-uuid",
  "fileUrl": "https://example.com/path/to/file.nwd",
  "fileName": "filename.nwd"
}
```

### Parameters:

- `userId`: The UUID of the user in the `users` table
- `fileUrl`: A publicly accessible URL to the file that needs to be processed
- `fileName`: The name to use when storing the file in BIMFACE

## Response Format

### Success Response:

```json
{
  "success": true,
  "message": "File processed successfully",
  "data": {
    "logId": "uuid-of-process-log",
    "fileId": 12345678,
    "projectId": "project-id-from-bimface",
    "token": "bimface-access-token",
    "status": "processing"
  }
}
```

### Error Response:

```json
{
  "error": "Error message",
  "details": {
    // Specific error details
  }
}
```

## Database Tables

The function relies on two tables:

1. `users` - Stores user information
2. `bim_process_logs` - Stores the processing status and results

## Local Development

To test locally, you'll need Supabase CLI installed:

```bash
# Install Supabase CLI
npm install -g supabase

# Start Supabase locally
supabase start

# Run the function locally
supabase functions serve process-bimfile --env-file .env.local
```

Create a `.env.local` file with:

```
SUPABASE_URL=your_local_supabase_url
SUPABASE_ANON_KEY=your_local_supabase_anon_key
```

## Deployment

Deploy the function to your Supabase project:

```bash
# Deploy to Supabase
supabase functions deploy process-bimfile --project-ref your-project-ref

# Set environment variables if needed
supabase secrets set --project-ref your-project-ref SOME_SECRET=some_value
```

## Usage Example

```bash
curl -X POST 'https://your-project-ref.supabase.co/functions/v1/process-bimfile' \
  -H 'Authorization: Bearer your-supabase-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "userId": "user-uuid",
    "fileUrl": "https://example.com/path/to/file.nwd",
    "fileName": "file.nwd"
  }'
```

## Monitoring

You can monitor the process status by querying the `bim_process_logs` table. The `progress` field indicates the current progress (0-100%), and the `status` field can be one of:
- `started` - Process has just started
- `processing` - Process is in progress
- `completed` - Process completed successfully
- `failed` - Process failed

When a process fails, check the `error` field for details about what went wrong. 