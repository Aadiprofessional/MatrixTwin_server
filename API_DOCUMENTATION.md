# MatrixBIM API Documentation

This document provides a comprehensive guide to the APIs created for the MatrixBIM Server, focusing on Authentication, Company Management, and Project Management.

## Base URL
All API endpoints are prefixed with `/api`.
Example: `https://server.matrixtwin.com/api/auth/login`

---

## 1. Authentication APIs
**Base Route:** `/api/auth`

### **Signup**
Registers a new user. If a valid `company_code` is provided, a join request is automatically created.
- **Method:** `POST`
- **Endpoint:** `/signup`
- **Access:** Public
- **Input (JSON):**
  ```json
  {
    "name": "John Doe",
    "email": "john@example.com",
    "password": "password123",
    "company_code": "OPTIONAL_CODE" 
  }
  ```
- **Response (Success):**
  ```json
  {
    "token": "jwt_token_string",
    "user": {
      "id": "uuid",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "user"
    }
  }
  ```

### **Login**
Authenticates a user and returns a JWT token.
- **Method:** `POST`
- **Endpoint:** `/login`
- **Access:** Public
- **Input (JSON):**
  ```json
  {
    "email": "john@example.com",
    "password": "password123"
  }
  ```
- **Response (Success):**
  ```json
  {
    "token": "jwt_token_string",
    "user": { ... }
  }
  ```

### **Get Current User**
Retrieves the profile of the currently logged-in user.
- **Method:** `GET`
- **Endpoint:** `/me`
- **Access:** Private (Header: `Authorization: Bearer <token>`)
- **Response:** User object.

---

## 2. Company Management APIs
**Base Route:** `/api/companies`

### **Create Company**
Creates a new company. The creator automatically becomes the **Owner**.
- **Method:** `POST`
- **Endpoint:** `/`
- **Access:** Private (**Owner** Role Only)
- **Input (JSON):**
  ```json
  {
    "name": "Matrix AI Global",
    "details": { "address": "..." } // Optional
  }
  ```
- **Response:**
  ```json
  {
    "message": "Company created successfully",
    "company": {
      "id": "uuid",
      "name": "Matrix AI Global",
      "code": "GENERATED_CODE"
    }
  }
  ```

### **Assign Admin**
Assigns a specific user as the Admin of a company. (1 Admin per Company).
- **Method:** `PUT`
- **Endpoint:** `/:id/assign-admin`
- **Access:** Private (**Owner** Role Only)
- **Input (JSON):**
  ```json
  {
    "admin_id": "user_uuid"
  }
  ```

### **Invite User**
Sends an email invitation to a user to join the company.
- **Method:** `POST`
- **Endpoint:** `/invite`
- **Access:** Private (**Admin** or **Owner**)
- **Input (JSON):**
  ```json
  {
    "email": "worker@example.com"
  }
  ```

### **Join Company**
Allows a user to request to join a company using its **Code** or **ID**.
- **Method:** `POST`
- **Endpoint:** `/join`
- **Access:** Private (Any Authenticated User)
- **Input (JSON):**
  ```json
  {
    "company_identifier": "COMPANY_CODE_OR_UUID"
  }
  ```

### **List Join Requests**
Lists all pending requests for the admin's company.
- **Method:** `GET`
- **Endpoint:** `/requests`
- **Access:** Private (**Admin** or **Owner**)

### **Approve Join Request**
Approves a user's request, adding them to `company_members`.
- **Method:** `PUT`
- **Endpoint:** `/requests/:id/approve`
- **Access:** Private (**Admin** or **Owner**)
- **Input (JSON):**
  ```json
  {
    "status": "approved"
  }
  ```

### **Reject Join Request**
Rejects a user's request.
- **Method:** `PUT`
- **Endpoint:** `/requests/:id/reject`
- **Access:** Private (**Admin** or **Owner**)
- **Input (JSON):**
  ```json
  {
    "status": "rejected"
  }
  ```

---

## 3. Project Management APIs
**Base Route:** `/api/projects`

### **List Projects**
Lists projects. 
- **Admins/Owners**: See ALL projects in the company.
- **Members**: See ONLY projects they are assigned to.
- **Method:** `GET`
- **Endpoint:** `/`
- **Access:** Private

### **Create Project**
Creates a new project within the company.
- **Method:** `POST`
- **Endpoint:** `/`
- **Access:** Private (**Admin** or **Owner**)
- **Input (Form-Data or JSON):**
  - `name`: "Project Alpha"
  - `status`: "upcoming" (or "in_progress", "completed")
  - `location`: "New York"
  - `client`: "Client Name"
  - `deadline`: "2024-12-31"
  - `image`: (File upload - Optional)

### **Update Project**
Updates project details.
- **Method:** `PUT`
- **Endpoint:** `/:id`
- **Access:** Private (**Admin** or **Owner**)
- **Input:** Same as Create Project.

### **Assign Members to Project**
Adds users to a specific project.
- **Method:** `POST`
- **Endpoint:** `/:id/members`
- **Access:** Private (**Admin** or **Owner**)
- **Input (JSON):**
  ```json
  {
    "userIds": ["uuid1", "uuid2"]
  }
  ```

### **Get Project Members**
Lists all users assigned to a project.
- **Method:** `GET`
- **Endpoint:** `/:id/members`
- **Access:** Private (Members of the project or Admin/Owner)

### **Remove Member from Project**
Removes a user from a project.
- **Method:** `DELETE`
- **Endpoint:** `/:id/members/:memberId`
- **Access:** Private (**Admin** or **Owner**)

---

## Testing with Curl (Examples)

### **Login**
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com", "password":"password123"}'
```

### **Create Company (Owner)**
```bash
curl -X POST http://localhost:5000/api/companies \
  -H "Authorization: Bearer <OWNER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Construction Co"}'
```

### **Create Project (Admin)**
```bash
curl -X POST http://localhost:5000/api/projects \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"New Skyscraper", "status":"upcoming"}'
```
