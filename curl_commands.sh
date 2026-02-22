#!/bin/bash

# --- 1. List Projects (Admin) ---
# Admin: 95ed2a2f-b239-4b9f-9ae1-cacd6e3f19f4
echo "Listing projects for Admin..."
curl -X GET http://localhost:6789/api/projects/list \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 95ed2a2f-b239-4b9f-9ae1-cacd6e3f19f4" \
  -H "dev-role: admin" \
  -H "Content-Type: application/json"
echo -e "\n"

# --- 2. List Projects (Owner) ---
# Owner: 3e4fda0e-3012-4b41-b95a-3ea61c859f39
echo "Listing projects for Owner..."
curl -X GET http://localhost:6789/api/projects/list \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 3e4fda0e-3012-4b41-b95a-3ea61c859f39" \
  -H "dev-role: owner" \
  -H "Content-Type: application/json"
echo -e "\n"

# --- 3. List Projects (Member) ---
# Member: b1d0618d-f639-46f2-880b-d6c21560f8e4
echo "Listing projects for Member..."
curl -X GET http://localhost:6789/api/projects/list \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: b1d0618d-f639-46f2-880b-d6c21560f8e4" \
  -H "dev-role: member" \
  -H "Content-Type: application/json"
echo -e "\n"

# --- 4. Create Project (Admin) ---
# Admin creates in their own company (requires company membership)
echo "Creating project as Admin..."
curl -X POST http://localhost:6789/api/projects/create \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 95ed2a2f-b239-4b9f-9ae1-cacd6e3f19f4" \
  -H "dev-role: admin" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Admin Project",
    "description": "Created by Admin via Curl",
    "status": "active",
    "location": "New York",
    "client": "Client A",
    "deadline": "2024-12-31"
  }'
echo -e "\n"

# --- 5. Create Project (Owner) ---
# Owner creates in ANY company (requires company_id)
# Replace TARGET_COMPANY_ID with a valid UUID from your database
TARGET_COMPANY_ID="REPLACE_WITH_VALID_UUID"
echo "Creating project as Owner..."
curl -X POST http://localhost:6789/api/projects/createOwner \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 3e4fda0e-3012-4b41-b95a-3ea61c859f39" \
  -H "dev-role: owner" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Owner Project\",
    \"description\": \"Created by Owner via Curl\",
    \"status\": \"active\",
    \"location\": \"London\",
    \"client\": \"Client B\",
    \"deadline\": \"2024-12-31\",
    \"company_id\": \"$TARGET_COMPANY_ID\"
  }"
echo -e "\n"
