# Test API Script

## 1. List Projects (Admin)
# Replace YOUR_ADMIN_TOKEN with a valid JWT for UID 95ed2a2f-b239-4b9f-9ae1-cacd6e3f19f4
# Or use dev headers locally:
# -H "dev-skip-auth: true" -H "dev-user-id: 95ed2a2f-b239-4b9f-9ae1-cacd6e3f19f4" -H "dev-role: admin"
curl -X GET http://localhost:6789/api/projects/list \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"

## 2. List Projects (Owner)
# Replace YOUR_OWNER_TOKEN with a valid JWT for UID 3e4fda0e-3012-4b41-b95a-3ea61c859f39
curl -X GET http://localhost:6789/api/projects/list \
  -H "Authorization: Bearer YOUR_OWNER_TOKEN" \
  -H "Content-Type: application/json"

## 3. List Projects (Member)
# Replace YOUR_MEMBER_TOKEN with a valid JWT for UID b1d0618d-f639-46f2-880b-d6c21560f8e4
curl -X GET http://localhost:6789/api/projects/list \
  -H "Authorization: Bearer YOUR_MEMBER_TOKEN" \
  -H "Content-Type: application/json"

## 4. Create Project (Admin)
# Admin creates in their own company (company_id inferred)
curl -X POST http://localhost:6789/api/projects/create \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Admin Project",
    "description": "Created by Admin",
    "status": "active",
    "location": "New York",
    "client": "Client A",
    "deadline": "2024-12-31"
  }'

## 5. Create Project (Owner)
# Owner must provide company_id
# Replace TARGET_COMPANY_ID with a valid UUID
curl -X POST http://localhost:6789/api/projects/createOwner \
  -H "Authorization: Bearer YOUR_OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Owner Project",
    "description": "Created by Owner in specific company",
    "status": "active",
    "location": "London",
    "client": "Client B",
    "deadline": "2024-12-31",
    "company_id": "TARGET_COMPANY_ID"
  }'
