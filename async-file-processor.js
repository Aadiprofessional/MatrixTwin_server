const express = require("express");
const axios = require("axios");
const multer = require("multer");
const Bull = require("bull");
const cors = require("cors");
const morgan = require("morgan");

const app = express();
const port = process.env.PORT || 5000;

// Always use in-memory queue for simplicity
console.log('Using in-memory queue for processing');

// Simple in-memory queue implementation for environments without Redis
class InMemoryQueue {
  constructor(name) {
    this.name = name;
    this.jobs = new Map();
    this.handlers = {};
    this.jobCounter = 0;
    this.events = {};
  }
  
  async add(data) {
    const jobId = ++this.jobCounter;
    const job = {
      id: jobId,
      data,
      status: 'waiting'
    };
    
    this.jobs.set(jobId, job);
    
    // Process the job asynchronously
    setTimeout(() => {
      if (this.processHandler) {
        this.processHandler(job);
      }
    }, 100);
    
    return job;
  }
  
  process(handler) {
    this.processHandler = handler;
  }
  
  async getJob(jobId) {
    return this.jobs.get(parseInt(jobId)) || null;
  }
  
  on(event, handler) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(handler);
  }
}

// Initialize the queue
const fileQueue = new InMemoryQueue("file-upload-queue");

// In-memory task status storage
let taskStatus = {};

// Set up multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit for cloud deployment
  }
});

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// API 1: Upload file and start processing
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { name, token } = req.body;
    const file = req.file;

    if (!token) {
      return res.status(400).json({ error: "Missing token" });
    }

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Use provided name or fallback to original filename
    const fileName = name || file.originalname;
    
    console.log(`Processing upload for file: ${fileName} (${file.size} bytes)`);

    // Create a new job for background processing
    const job = await fileQueue.add({
      name: fileName,
      token,
      fileBuffer: file.buffer,
    });

    // Store initial task status
    taskStatus[job.id] = { 
      status: "processing", 
      result: null,
      progress: 0,
      startTime: new Date().toISOString()
    };

    // Respond with the job ID to the client
    res.status(200).json({ 
      success: true,
      message: "File uploaded, processing started", 
      jobId: job.id 
    });
  } catch (error) {
    console.error("Error handling upload:", error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// API 2: Check job status and get result
app.get("/status/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    // Check if job ID exists
    if (!taskStatus[jobId]) {
      return res.status(404).json({ 
        success: false,
        error: "Job not found" 
      });
    }

    const task = taskStatus[jobId];

    // Return appropriate response based on status
    return res.status(200).json({
      success: true,
      jobId,
      status: task.status,
      progress: task.progress || 0,
      startTime: task.startTime,
      ...(task.status === 'completed' && { result: task.result }),
      ...(task.status === 'failed' && { error: task.result })
    });
  } catch (error) {
    console.error("Error checking status:", error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Background worker to process the file upload
fileQueue.process(async (job) => {
  const { name, token, fileBuffer } = job.data;

  try {
    console.log(`Starting background job ${job.id} for file ${name}`);
    
    // Update progress periodically to simulate a long-running task
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += 10;
      if (progress <= 90) {
        console.log(`Job ${job.id} progress: ${progress}%`);
        taskStatus[job.id].progress = progress;
      }
    }, 1000);
    
    // Upload to BIMFace
    console.log(`Uploading file to BIMFace: ${name}`);
    const response = await axios.put(
      `https://file.bimface.com/upload?name=${encodeURIComponent(name)}`,
      fileBuffer,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );

    // Clear the progress interval
    clearInterval(progressInterval);
    
    // Update the status of the task in memory
    taskStatus[job.id].status = "completed";
    taskStatus[job.id].result = response.data;
    taskStatus[job.id].progress = 100;
    taskStatus[job.id].completionTime = new Date().toISOString();

    console.log(`Job ${job.id} completed`);
    return response.data;
  } catch (error) {
    console.error(`Error processing job ${job.id}:`, error);
    taskStatus[job.id].status = "failed";
    taskStatus[job.id].result = error.message;
    return { error: error.message };
  }
});

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Async File Processor",
    endpoints: {
      upload: "/upload (POST)",
      status: "/status/:jobId (GET)"
    }
  });
});

// List all jobs (for debugging)
app.get("/jobs", (req, res) => {
  const jobs = Object.entries(taskStatus).map(([jobId, status]) => ({
    jobId,
    status: status.status,
    progress: status.progress || 0,
    startTime: status.startTime,
    completionTime: status.completionTime
  }));
  
  res.json({
    count: jobs.length,
    jobs
  });
});

// Start the Express server
if (!module.parent) {
  app.listen(port, () => {
    console.log(`Async File Processor running on http://localhost:${port}`);
  });
}

module.exports = app; 