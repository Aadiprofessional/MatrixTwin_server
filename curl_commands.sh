#!/bin/bash

# Base URL
BASE_URL="https://server.matrixtwin.com"

# --- 0. Auth APIs ---

# Signup (New User)
echo "Signing up a new user..."
curl -X POST "$BASE_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "testuser@example.com",
    "password": "password123"
  }'
echo -e "\n"

# Login (Existing User)
echo "Logging in..."
curl -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testuser@example.com",
    "password": "password123"
  }'
echo -e "\n"

# --- 1. Admin Requests (User & Owner) ---

# 1.1 Submit Admin Request (User)
# Replace USER_ID with the ID of a 'user' role account
USER_ID="REPLACE_WITH_USER_ID"
echo "Submitting Admin Request as User..."
curl -X POST "$BASE_URL/api/admin-requests/request-admin" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: $USER_ID" \
  -H "dev-role: user" \
  -H "Content-Type: application/json" \
  -d '{
    "company_name": "New Construction Co",
    "company_details": {
        "address": "123 Builder Lane",
        "phone": "555-0199",
        "website": "https://newco.com"
    }
  }'
echo -e "\n"

# 1.2 List Requests (Owner)
echo "Listing Admin Requests as Owner..."
curl -X GET "$BASE_URL/api/admin-requests/requests" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 3e4fda0e-3012-4b41-b95a-3ea61c859f39" \
  -H "dev-role: owner" \
  -H "Content-Type: application/json"
echo -e "\n"

# 1.3 Approve Request (Owner)
# Replace REQUEST_ID with a valid pending request ID
REQUEST_ID="REPLACE_WITH_REQUEST_ID"
echo "Approving Admin Request as Owner..."
curl -X PUT "$BASE_URL/api/admin-requests/requests/$REQUEST_ID/approve" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 3e4fda0e-3012-4b41-b95a-3ea61c859f39" \
  -H "dev-role: owner" \
  -H "Content-Type: application/json"
echo -e "\n"

# 1.4 Reject Request (Owner)
# Replace REQUEST_ID with a valid pending request ID
echo "Rejecting Admin Request as Owner..."
curl -X PUT "$BASE_URL/api/admin-requests/requests/$REQUEST_ID/reject" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 3e4fda0e-3012-4b41-b95a-3ea61c859f39" \
  -H "dev-role: owner" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Company details are incomplete."
  }'
echo -e "\n"

# 1.5 Edit/Resubmit Request (User)
# User can edit if status is pending or rejected
echo "Resubmitting Admin Request as User..."
curl -X PUT "$BASE_URL/api/admin-requests/request-admin/$REQUEST_ID" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: $USER_ID" \
  -H "dev-role: user" \
  -H "Content-Type: application/json" \
  -d '{
    "company_name": "New Construction Co (Revised)",
    "company_details": {
        "address": "123 Builder Lane, Suite 100",
        "phone": "555-0199"
    }
  }'
echo -e "\n"

# --- 2. List Projects (Admin) ---
# Admin: 95ed2a2f-b239-4b9f-9ae1-cacd6e3f19f4
echo "Listing projects for Admin..."
curl -X GET "$BASE_URL/api/projects/list" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 95ed2a2f-b239-4b9f-9ae1-cacd6e3f19f4" \
  -H "dev-role: admin" \
  -H "Content-Type: application/json"
echo -e "\n"

# --- 3. List Projects (Owner) ---
# Owner: 3e4fda0e-3012-4b41-b95a-3ea61c859f39
echo "Listing projects for Owner..."
curl -X GET "$BASE_URL/api/projects/list" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 3e4fda0e-3012-4b41-b95a-3ea61c859f39" \
  -H "dev-role: owner" \
  -H "Content-Type: application/json"
echo -e "\n"

# --- 4. List Projects (Member) ---
# Member: b1d0618d-f639-46f2-880b-d6c21560f8e4
echo "Listing projects for Member..."
curl -X GET "$BASE_URL/api/projects/list" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: b1d0618d-f639-46f2-880b-d6c21560f8e4" \
  -H "dev-role: member" \
  -H "Content-Type: application/json"
echo -e "\n"

# --- 5. Create Project (Admin) ---
# Admin creates in their own company (requires company membership)
echo "Creating project as Admin..."
curl -X POST "$BASE_URL/api/projects/create" \
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
    "deadline": "2024-12-31",
    "image": "https://example.com/project.jpg"
  }'
echo -e "\n"

# --- 6. Create Project (Owner) ---
# Owner creates in ANY company (requires company_id)
# Replace TARGET_COMPANY_ID with a valid UUID from your database
TARGET_COMPANY_ID="REPLACE_WITH_VALID_UUID"
echo "Creating project as Owner..."
curl -X POST "$BASE_URL/api/projects/createOwner" \
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
    \"company_id\": \"$TARGET_COMPANY_ID\",
    \"image\": \"https://example.com/owner_project.jpg\"
  }"
echo -e "\n"

# --- 7. Update Project (Admin) ---
# Admin can update projects in their company. Replace PROJECT_ID with a valid ID.
PROJECT_ID="REPLACE_WITH_PROJECT_ID"
echo "Updating project as Admin..."
curl -X PUT "$BASE_URL/api/projects/$PROJECT_ID" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 95ed2a2f-b239-4b9f-9ae1-cacd6e3f19f4" \
  -H "dev-role: admin" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Admin Updated Project",
    "status": "completed",
    "location": "New Jersey",
    "image": "https://example.com/updated.jpg"
  }'
echo -e "\n"

# --- 8. Update Project (Owner) ---
# Owner can update ANY project. Replace PROJECT_ID with a valid ID.
echo "Updating project as Owner..."
curl -X PUT "$BASE_URL/api/projects/$PROJECT_ID" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 3e4fda0e-3012-4b41-b95a-3ea61c859f39" \
  -H "dev-role: owner" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Owner Updated Project",
    "status": "archived",
    "client": "New Client C"
  }'
echo -e "\n"

# --- 9. Delete Project (Admin) ---
# Admin can delete projects in their company. Replace PROJECT_ID with a valid ID.
echo "Deleting project as Admin..."
curl -X DELETE "$BASE_URL/api/projects/$PROJECT_ID" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 95ed2a2f-b239-4b9f-9ae1-cacd6e3f19f4" \
  -H "dev-role: admin" \
  -H "Content-Type: application/json"
echo -e "\n"

# --- 10. Delete Project (Owner) ---
# Owner can delete ANY project. Replace PROJECT_ID with a valid ID.
echo "Deleting project as Owner..."
curl -X DELETE "$BASE_URL/api/projects/$PROJECT_ID" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 3e4fda0e-3012-4b41-b95a-3ea61c859f39" \
  -H "dev-role: owner" \
  -H "Content-Type: application/json"
echo -e "\n"

# --- 11. Company Membership APIs ---

# 11.1 Join Company Request (User)
# User with NO company requests to join. Replace COMPANY_ID.
COMPANY_ID="REPLACE_WITH_COMPANY_ID"
USER_ID_NO_COMPANY="REPLACE_WITH_USER_ID"
echo "Requesting to join company as User..."
curl -X POST "$BASE_URL/api/companies/join" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: $USER_ID_NO_COMPANY" \
  -H "dev-role: user" \
  -H "Content-Type: application/json" \
  -d "{
    \"company_id\": \"$COMPANY_ID\"
  }"
echo -e "\n"

# 11.2 List Join Requests (Admin)
echo "Listing join requests as Admin..."
curl -X GET "$BASE_URL/api/companies/requests" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 95ed2a2f-b239-4b9f-9ae1-cacd6e3f19f4" \
  -H "dev-role: admin" \
  -H "Content-Type: application/json"
echo -e "\n"

# 11.3 Approve Join Request (Admin)
REQUEST_ID="REPLACE_WITH_REQUEST_ID"
echo "Approving join request as Admin..."
curl -X PUT "$BASE_URL/api/companies/requests/$REQUEST_ID/approve" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 95ed2a2f-b239-4b9f-9ae1-cacd6e3f19f4" \
  -H "dev-role: admin" \
  -H "Content-Type: application/json"
echo -e "\n"

# 11.4 List Members (Admin)
echo "Listing members as Admin..."
curl -X GET "$BASE_URL/api/companies/members" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 95ed2a2f-b239-4b9f-9ae1-cacd6e3f19f4" \
  -H "dev-role: admin" \
  -H "Content-Type: application/json"
echo -e "\n"

# 11.5 List Members (Owner - All)
echo "Listing all members as Owner..."
curl -X GET "$BASE_URL/api/companies/members" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 3e4fda0e-3012-4b41-b95a-3ea61c859f39" \
  -H "dev-role: owner" \
  -H "Content-Type: application/json"
echo -e "\n"

# 11.6 Remove Member (Admin)
MEMBER_ID_TO_REMOVE="REPLACE_WITH_MEMBER_ID"
echo "Removing member as Admin..."
curl -X DELETE "$BASE_URL/api/companies/members/$MEMBER_ID_TO_REMOVE" \
  -H "dev-skip-auth: true" \
  -H "dev-user-id: 95ed2a2f-b239-4b9f-9ae1-cacd6e3f19f4" \
  -H "dev-role: admin" \
  -H "Content-Type: application/json"
echo -e "\n"
