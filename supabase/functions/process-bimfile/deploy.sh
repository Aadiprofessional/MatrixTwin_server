#!/bin/bash

# Deploy script for the process-bimfile edge function
# Usage: ./deploy.sh [project-ref]

# Check if supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "Supabase CLI not found. Please install it with 'npm install -g supabase'"
    exit 1
fi

# Get project ref from argument or prompt for it
PROJECT_REF=$1
if [ -z "$PROJECT_REF" ]; then
    read -p "Enter your Supabase project ref: " PROJECT_REF
fi

if [ -z "$PROJECT_REF" ]; then
    echo "Project ref is required."
    exit 1
fi

echo "Deploying process-bimfile function to project $PROJECT_REF..."

# Deploy the function
supabase functions deploy process-bimfile --project-ref "$PROJECT_REF"

if [ $? -eq 0 ]; then
    echo "Function deployed successfully!"
    echo "You can now call it using:"
    echo "curl -X POST 'https://$PROJECT_REF.supabase.co/functions/v1/process-bimfile' \\"
    echo "  -H 'Authorization: Bearer [YOUR_TOKEN]' \\"
    echo "  -H 'Content-Type: application/json' \\"
    echo "  -d '{\"userId\": \"USER_UUID\", \"fileUrl\": \"https://example.com/file.nwd\", \"fileName\": \"file.nwd\"}'"
else
    echo "Deployment failed."
fi 