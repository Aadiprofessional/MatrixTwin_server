#!/bin/bash

# Test script for Inspection APIs
# Usage: ./test_inspection_apis.sh

BASE_URL="http://localhost:5001"
USER_ID="5fcf581f-f854-459b-b521-aae507891337"
EMAIL="admin@buildsphere.com"
PASSWORD="admin123"

echo "=== TESTING INSPECTION APIs ==="
echo "Base URL: $BASE_URL"
echo "User ID: $USER_ID"
echo "Email: $EMAIL"
echo ""

# Function to get auth token
get_auth_token() {
    echo "Getting authentication token..."
    TOKEN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
    
    echo "Auth response: $TOKEN_RESPONSE"
    TOKEN=$(echo $TOKEN_RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)
    
    if [ -z "$TOKEN" ]; then
        echo "Failed to get authentication token"
        exit 1
    fi
    
    echo "Token obtained: ${TOKEN:0:20}..."
    echo ""
}

# Function to test API endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4
    
    echo "Testing: $description"
    echo "Method: $method"
    echo "Endpoint: $endpoint"
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X GET "$BASE_URL$endpoint" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json")
    elif [ "$method" = "POST" ]; then
        response=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL$endpoint" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json" \
            -d "$data")
    elif [ "$method" = "PUT" ]; then
        response=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X PUT "$BASE_URL$endpoint" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json" \
            -d "$data")
    elif [ "$method" = "DELETE" ]; then
        response=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X DELETE "$BASE_URL$endpoint" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json")
    fi
    
    http_code=$(echo "$response" | grep "HTTP_CODE:" | cut -d: -f2)
    body=$(echo "$response" | sed '/HTTP_CODE:/d')
    
    echo "HTTP Code: $http_code"
    echo "Response: $body"
    echo "---"
    echo ""
}

# Get authentication token
get_auth_token

# Test 1: Create Inspection Entry
echo "=== TEST 1: Create Inspection Entry ==="
CREATE_DATA='{
    "formData": {
        "inspectionDate": "2024-07-11",
        "projectId": "test-project-123",
        "inspectedBy": "Test Inspector",
        "contractNo": "CT-2024-001",
        "riscNo": "RISC-001",
        "revision": "Rev 1.0",
        "supervisor": "Test Supervisor",
        "attention": "Project Manager",
        "location": "Building A - Floor 2",
        "worksToBeInspected": "Concrete pouring and finishing",
        "worksCategory": "Structural",
        "inspectionTime": "14:30",
        "nextOperation": "Curing and testing",
        "generalCleaning": "Completed",
        "scheduledTime": "09:00",
        "scheduledDate": "2024-07-12",
        "equipment": "Concrete mixer, vibrator",
        "noObjection": true,
        "deficienciesNoted": false,
        "deficiencies": []
    },
    "processNodes": [
        {
            "id": "start",
            "type": "start",
            "name": "Start",
            "editAccess": true,
            "settings": {}
        },
        {
            "id": "review",
            "type": "node",
            "name": "Review & Approval",
            "executorId": "5fcf581f-f854-459b-b521-aae507891337",
            "executor": "Admin User",
            "editAccess": true,
            "ccRecipients": [],
            "settings": {}
        },
        {
            "id": "end",
            "type": "end",
            "name": "Complete",
            "editAccess": false,
            "settings": {}
        }
    ],
    "createdBy": "5fcf581f-f854-459b-b521-aae507891337",
    "projectId": "test-project-123"
}'

test_endpoint "POST" "/api/inspection/create" "$CREATE_DATA" "Create new inspection entry"

# Test 2: List Inspection Entries
echo "=== TEST 2: List Inspection Entries ==="
test_endpoint "GET" "/api/inspection/list/$USER_ID" "" "Get all inspection entries for user"

# Test 3: List Inspection Entries with Project Filter
echo "=== TEST 3: List Inspection Entries with Project Filter ==="
test_endpoint "GET" "/api/inspection/list/$USER_ID?projectId=test-project-123" "" "Get inspection entries filtered by project"

echo "=== INSPECTION API TESTING COMPLETE ===" 