#!/bin/bash

# Configuration
API_URL="http://localhost:6789/api"
ADMIN_EMAIL="admin@matrixaiglobal.com"
ADMIN_PASSWORD="admin123"

USER_EMAIL="anadi.mpvm@gmail.com"
COMPANY_NAME="CurlCompany_Anadi"

echo " =========================================== "
echo "    Testing MatrixBIM APIs with CURL "
echo " =========================================== "
echo " API URL: $API_URL"
echo " Admin: $ADMIN_EMAIL"
echo " New User: $USER_EMAIL"
echo " =========================================== "

# 1. Login as Admin
echo ""
echo " 1. Logging in as Admin..."
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\", \"password\":\"$ADMIN_PASSWORD\"}")

ADMIN_TOKEN=$(echo "$LOGIN_RESPONSE" | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf-8')); console.log(r.token || '')")

if [ -z "$ADMIN_TOKEN" ]; then
  echo " Error: Admin login failed."
  echo " Response: $LOGIN_RESPONSE"
  exit 1
fi
echo " Success! Admin Token received."

# 2. Create Company
echo ""
echo " 2. Creating Company '$COMPANY_NAME'..."
# Generate random suffix to avoid unique constraint error
COMPANY_RESPONSE=$(curl -s -X POST "$API_URL/companies" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$COMPANY_NAME\", \"details\":{\"address\":\"123 Main St\"}}")

COMPANY_ID=$(echo "$COMPANY_RESPONSE" | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf-8')); console.log(r.company ? r.company.id : (r.id || ''))")
# Extract Company Code using node
COMPANY_CODE=$(echo "$COMPANY_RESPONSE" | node -e "
  const res = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
  console.log(res.company ? res.company.code : (res.code || ''));
")

if [ -z "$COMPANY_ID" ]; then
  echo " Error: Company creation failed."
  echo " Response: $COMPANY_RESPONSE"
  exit 1
fi
echo " Company ID: $COMPANY_ID"
echo " Company Code: >$COMPANY_CODE<"

# 3. Invite User
echo ""
echo " 3. Sending Invite to $USER_EMAIL..."
INVITE_RESPONSE=$(curl -s -X POST "$API_URL/companies/invite" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$USER_EMAIL\", \"company_id\":\"$COMPANY_ID\"}")

echo " Response: $INVITE_RESPONSE"

# 4. Signup User with Code (Simulate user accepting invite)
# Note: Since we are using a real email, we can't fully simulate signup if the user already exists.
# We will try to signup, but if it fails (user exists), we will try to login and then create a join request manually if needed.
# OR better: The user asked to "test on this email... even if i accept...".
# So we should try to signup. If user exists, we assume they are logging in.

echo ""
echo " 4. Attempting Signup/Login for $USER_EMAIL with Code: $COMPANY_CODE..."

# Try Signup
SIGNUP_RESPONSE=$(curl -s -X POST "$API_URL/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Anadi User\", \"email\":\"$USER_EMAIL\", \"password\":\"password123\", \"company_code\":\"$COMPANY_CODE\"}")

USER_ID=$(echo "$SIGNUP_RESPONSE" | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf-8')); console.log(r.user ? r.user.id : '')")

if [ -z "$USER_ID" ]; then
  # Check if failure is due to user already existing
  MSG=$(echo "$SIGNUP_RESPONSE" | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf-8')); console.log(r.message || '')")
  if [[ "$MSG" == *"User already registered"* ]]; then
      echo " User already exists. Logging in..."
      USER_LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$USER_EMAIL\", \"password\":\"password123\"}")
      USER_TOKEN=$(echo "$USER_LOGIN_RESPONSE" | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf-8')); console.log(r.token || '')")
      USER_ID=$(echo "$USER_LOGIN_RESPONSE" | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf-8')); console.log(r.user ? r.user.id : '')")
      
      if [ -z "$USER_TOKEN" ]; then
          echo " Error: User login failed. Response: $USER_LOGIN_RESPONSE"
          exit 1
      fi
      echo " Logged in successfully. Creating join request manually..."
      # Create join request manually since signup was skipped
      JOIN_RESPONSE=$(curl -s -X POST "$API_URL/companies/join" \
        -H "Authorization: Bearer $USER_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"company_identifier\":\"$COMPANY_CODE\"}")
      echo " Join Request Response: $JOIN_RESPONSE"
  else
      echo " Error: Signup failed."
      echo " Response: $SIGNUP_RESPONSE"
      exit 1
  fi
else
  echo " Success! User Signed Up. User ID: $USER_ID"
fi

# 5. Admin Approves Request
echo ""
echo " 5. Admin Checking & Approving Request..."

# Fetch requests
REQUESTS_RESPONSE=$(curl -s -X GET "$API_URL/companies/requests?company_id=$COMPANY_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN")

REQUEST_ID=$(echo "$REQUESTS_RESPONSE" | node -e "
  const res = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
  const req = Array.isArray(res) ? res.find(r => r.user_id === '$USER_ID') : null;
  console.log(req ? req.id : '');
")

if [ -z "$REQUEST_ID" ]; then
  echo " Error: Request not found for user $USER_ID."
  echo " Response: $REQUESTS_RESPONSE"
  # Don't exit, maybe it was auto-approved? (Unlikely per requirements)
else
  echo " Found Request ID: $REQUEST_ID. Approving..."
  APPROVE_RESPONSE=$(curl -s -X PUT "$API_URL/companies/requests/$REQUEST_ID/approve" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"approved\"}")
  echo " Approve Response: $APPROVE_RESPONSE"
fi

# 6. Verify Membership
echo ""
echo " 6. Verifying Membership..."
# We can verify by checking if the user can access company details or by admin checking members list
MEMBERS_RESPONSE=$(curl -s -X GET "$API_URL/companies/$COMPANY_ID/members" \
  -H "Authorization: Bearer $ADMIN_TOKEN")

IS_MEMBER=$(echo "$MEMBERS_RESPONSE" | node -e "
  const res = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
  const member = Array.isArray(res) ? res.find(m => m.user_id === '$USER_ID') : null;
  console.log(member ? 'YES' : 'NO');
")

if [ "$IS_MEMBER" == "YES" ]; then
  echo " SUCCESS: User is now a member of the company."
else
  echo " FAILURE: User not found in company members list."
  echo " Members: $MEMBERS_RESPONSE"
fi
