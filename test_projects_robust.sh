#!/bin/bash

# Configuration
API_URL="http://localhost:6789/api"
ADMIN_EMAIL="admin@matrixaiglobal.com"
ADMIN_PASSWORD="admin123"
USER_EMAIL="anadi.mpvm@gmail.com"
USER_PASSWORD="user123"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'
YELLOW='\033[1;33m'

echo "---------------------------------------------------"
echo "Testing Project Management APIs (Robust)"
echo "---------------------------------------------------"

# 1. Login as Admin
echo -e "\n${GREEN}1. Logging in as Admin...${NC}"
ADMIN_TOKEN=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\", \"password\":\"$ADMIN_PASSWORD\"}" | jq -r '.token')

if [ "$ADMIN_TOKEN" == "null" ] || [ -z "$ADMIN_TOKEN" ]; then
  echo -e "${RED}Admin login failed${NC}"
  exit 1
fi
echo "Admin Token obtained"

# 2. Login as User (Try signup if fails)
echo -e "\n${GREEN}2. Logging in as User...${NC}"
USER_LOGIN_RES=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$USER_EMAIL\", \"password\":\"$USER_PASSWORD\"}")

USER_TOKEN=$(echo $USER_LOGIN_RES | jq -r '.token')
USER_ID=$(echo $USER_LOGIN_RES | jq -r '.user.id')

if [ "$USER_TOKEN" == "null" ] || [ -z "$USER_TOKEN" ]; then
  echo -e "${YELLOW}User login failed, trying signup...${NC}"
  # Just signup, assuming company code might not be needed for basic user or will fail later
  USER_SIGNUP_RES=$(curl -s -X POST "$API_URL/auth/signup" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$USER_EMAIL\", \"password\":\"$USER_PASSWORD\", \"name\":\"Test User\"}")
    
  USER_TOKEN=$(echo $USER_SIGNUP_RES | jq -r '.token')
  USER_ID=$(echo $USER_SIGNUP_RES | jq -r '.user.id')
fi

if [ "$USER_TOKEN" == "null" ] || [ -z "$USER_TOKEN" ]; then
    echo -e "${RED}User login/signup failed completely${NC}"
else 
    echo "User Token obtained. User ID: $USER_ID"
fi


# 3. Create NEW Company (to ensure we are owner and member)
# This handles the case where previous companies didn't have the 'company_members' link
echo -e "\n${GREEN}3. Creating NEW Company (Admin)...${NC}"
COMPANY_NAME="Matrix Projects Corp $(date +%s)"
COMPANY_RESPONSE=$(curl -s -X POST "$API_URL/companies" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"$COMPANY_NAME\",
    \"details\": { \"description\": \"Test Company for Projects\" }
  }")

COMPANY_ID=$(echo $COMPANY_RESPONSE | jq -r '.company.id')
COMPANY_CODE=$(echo $COMPANY_RESPONSE | jq -r '.company.company_code')

if [ "$COMPANY_ID" == "null" ]; then
  echo -e "${RED}Company creation failed:${NC}"
  echo $COMPANY_RESPONSE
  # Try to continue with existing company if possible? No, projects need company_id
else
  echo -e "${GREEN}Company created: $COMPANY_ID (Code: $COMPANY_CODE)${NC}"
fi

# 4. Create Project (Admin)
echo -e "\n${GREEN}4. Creating Project (Admin)...${NC}"
PROJECT_NAME="Skyline Tower $(date +%s)"
PROJECT_RESPONSE=$(curl -s -X POST "$API_URL/projects" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"$PROJECT_NAME\",
    \"description\": \"Building the future\",
    \"location\": \"New York\",
    \"client\": \"Stark Industries\",
    \"deadline\": \"2026-12-31\",
    \"status\": \"upcoming\"
  }")

PROJECT_ID=$(echo $PROJECT_RESPONSE | jq -r '.id')

if [ "$PROJECT_ID" == "null" ]; then
  echo -e "${RED}Project creation failed:${NC}"
  echo $PROJECT_RESPONSE
else
  echo -e "${GREEN}Project created: $PROJECT_ID${NC}"
fi

# 5. List Projects (Admin)
echo -e "\n${GREEN}5. Listing Projects (Admin)...${NC}"
curl -s -X GET "$API_URL/projects" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.'

# 6. Assign User to Project (Admin)
# Note: User must be in company first!
if [ ! -z "$USER_ID" ] && [ "$PROJECT_ID" != "null" ]; then
  # First, add user to company (simulating invite acceptance or admin assignment)
  # We don't have a direct "add member" API for admin without invite flow, 
  # BUT we can try to use the join request flow or just skip this if too complex without SQL.
  # WAIT! We can use the 'invite' flow if we want, but that requires email.
  # Let's try to add user to project directly. If RLS works, it might fail if user is not in company_members.
  # BUT the project member assignment API checks if ADMIN is in company, not if USER is in company (though it should).
  
  echo -e "\n${GREEN}6. Assigning User to Project...${NC}"
  ASSIGN_RES=$(curl -s -X POST "$API_URL/projects/$PROJECT_ID/members" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"userIds\": [\"$USER_ID\"]}")
    
  echo $ASSIGN_RES | jq '.'
  
  # If assignment worked, check if user can see it
  echo -e "\n${GREEN}7. Listing Projects (User)...${NC}"
  # User needs to be in company members to even call GET /projects?
  # The API checks:
  # const { data: membership } = await supabase.from('company_members')...
  # So if user is not in company_members, this will fail with 404.
  
  curl -s -X GET "$API_URL/projects" \
    -H "Authorization: Bearer $USER_TOKEN" | jq '.'
fi

# 8. Update Project Status (Admin)
if [ "$PROJECT_ID" != "null" ]; then
  echo -e "\n${GREEN}8. Updating Project Status...${NC}"
  curl -s -X PUT "$API_URL/projects/$PROJECT_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\": \"in_progress\"}" | jq '.'
fi

echo -e "\n${GREEN}Test Complete${NC}"
