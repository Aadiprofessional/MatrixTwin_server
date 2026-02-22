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

echo "---------------------------------------------------"
echo "Testing Project Management APIs"
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

# 2. Login as User
echo -e "\n${GREEN}2. Logging in as User...${NC}"
USER_TOKEN=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$USER_EMAIL\", \"password\":\"$USER_PASSWORD\"}" | jq -r '.token')
USER_ID=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$USER_EMAIL\", \"password\":\"$USER_PASSWORD\"}" | jq -r '.user.id')

if [ "$USER_TOKEN" == "null" ] || [ -z "$USER_TOKEN" ]; then
  echo -e "${RED}User login failed${NC}"
  # Continue anyway, maybe user not created yet
else
  echo "User Token obtained. User ID: $USER_ID"
fi

# 3. Create Project (Admin)
echo -e "\n${GREEN}3. Creating Project (Admin)...${NC}"
PROJECT_NAME="Matrix Tower $(date +%s)"
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

# 4. List Projects (Admin)
echo -e "\n${GREEN}4. Listing Projects (Admin)...${NC}"
curl -s -X GET "$API_URL/projects" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.'

# 5. List Projects (User) - Should be empty or not contain the new project yet
if [ ! -z "$USER_TOKEN" ]; then
  echo -e "\n${GREEN}5. Listing Projects (User - Before Assignment)...${NC}"
  curl -s -X GET "$API_URL/projects" \
    -H "Authorization: Bearer $USER_TOKEN" | jq '.'
fi

# 6. Assign User to Project (Admin)
if [ ! -z "$USER_ID" ] && [ "$PROJECT_ID" != "null" ]; then
  echo -e "\n${GREEN}6. Assigning User to Project...${NC}"
  curl -s -X POST "$API_URL/projects/$PROJECT_ID/members" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"userIds\": [\"$USER_ID\"]}" | jq '.'
fi

# 7. List Projects (User) - Should now see the project
if [ ! -z "$USER_TOKEN" ]; then
  echo -e "\n${GREEN}7. Listing Projects (User - After Assignment)...${NC}"
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
