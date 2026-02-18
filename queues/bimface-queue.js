const Bull = require('bull');
const axios = require('axios');

// Create a connection configuration
const redisConfig = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined
  }
};

// Check if we should use in-memory queue (for local testing without Redis)
const useInMemoryQueue = process.env.USE_IN_MEMORY_QUEUE === 'true' || !process.env.REDIS_URL;

// BIMFace credentials
const BIMFACE_APP_KEY = process.env.BIMFACE_APP_KEY || 'rHue4iORWkUqAAee4Maj5oAOv8byfRiN';
const BIMFACE_APP_SECRET = process.env.BIMFACE_APP_SECRET || 'S76cdgQlT1pZg14EvYzPAHRjERsX8qVU';

// Store task status in memory (in production, you'd use Redis or a database)
const taskStatus = {};

// Create a simple in-memory queue implementation for local testing
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
      status: 'waiting',
      progress: 0,
      returnvalue: null,
      finishedOn: null,
      failedReason: null
    };
    
    this.jobs.set(jobId, job);
    
    // Process the job asynchronously
    setTimeout(() => this.processJob(jobId), 100);
    
    return job;
  }
  
  process(handler) {
    this.processHandler = handler;
  }
  
  async getJob(jobId) {
    return this.jobs.get(parseInt(jobId)) || null;
  }
  
  async processJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || !this.processHandler) return;
    
    job.status = 'active';
    
    try {
      // Call the handler
      job.returnvalue = await this.processHandler(job);
      job.status = 'completed';
      job.finishedOn = new Date();
      
      // Emit completed event
      if (this.events['completed']) {
        this.events['completed'].forEach(handler => handler(job, job.returnvalue));
      }
    } catch (error) {
      job.status = 'failed';
      job.failedReason = error.message;
      job.finishedOn = new Date();
      
      // Emit failed event
      if (this.events['failed']) {
        this.events['failed'].forEach(handler => handler(job, error));
      }
    }
  }
  
  on(event, handler) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(handler);
  }
}

// Create the appropriate queue
let bimfaceQueue;

if (useInMemoryQueue) {
  console.log('Using in-memory queue for local testing (Redis not available)');
  bimfaceQueue = new InMemoryQueue('bimface-processing');
} else {
  console.log('Using Bull queue with Redis');
  bimfaceQueue = new Bull('bimface-processing', redisConfig);
}

// Get BIMFace access token
async function getBimfaceToken() {
  try {
    console.log('Generating new BIMFace token...');
    
    // Create the auth string for Basic Auth (app_key:app_secret)
    const authString = `${BIMFACE_APP_KEY}:${BIMFACE_APP_SECRET}`;
    const base64Auth = Buffer.from(authString).toString('base64');
    
    // Request the token
    const response = await axios.post(
      'https://api.bimface.com/oauth2/token',
      'grant_type=client_credentials',
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${base64Auth}`
        }
      }
    );
    
    if (response.data && response.data.data && response.data.data.token) {
      console.log('BIMFace token generated successfully');
      return response.data.data.token;
    } else {
      throw new Error('Invalid token response format');
    }
  } catch (error) {
    console.error('Error generating BIMFace token:', error);
    throw error;
  }
}

// Upload file to BIMFace
async function uploadFileToBimface(fileName, fileBuffer, token) {
  try {
    console.log(`Uploading file to BIMFace: ${fileName}`);
    
    const response = await axios.put(
      `https://file.bimface.com/upload?name=${encodeURIComponent(fileName)}`,
      fileBuffer,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );
    
    console.log('File upload completed:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error uploading file to BIMFace:', error);
    throw error;
  }
}

// Translate file to BIMtiles
async function translateToBimtiles(fileId, token) {
  try {
    console.log(`Translating file ${fileId} to BIMtiles`);
    
    const response = await axios.put(
      'https://api.bimface.com/v2/translate',
      {
        source: {
          fileId: fileId,
          compressed: false
        },
        config: {
          toBimtiles: true
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Translation completed:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error translating file to BIMtiles:', error);
    throw error;
  }
}

// Process jobs in the queue
bimfaceQueue.process(async (job) => {
  const { fileId: userFileId, name, fileBuffer, uid, project_id, user_name } = job.data;
  
  try {
    // Update status to initialized
    taskStatus[job.id] = { 
      status: 'processing', 
      currentStep: 'initializing',
      result: null, 
      fileId: userFileId,
      progress: 0,
      userId: uid,
      projectId: project_id,
      userName: user_name,
      steps: {
        tokenGeneration: { status: 'pending', data: null },
        fileUpload: { status: 'pending', data: null },
        translation: { status: 'pending', data: null }
      }
    };
    
    // Step 1: Generate BIMFace token
    taskStatus[job.id].currentStep = 'generating_token';
    taskStatus[job.id].progress = 10;
    taskStatus[job.id].steps.tokenGeneration.status = 'processing';
    
    const token = await getBimfaceToken();
    
    taskStatus[job.id].steps.tokenGeneration.status = 'completed';
    taskStatus[job.id].steps.tokenGeneration.data = { token };
    taskStatus[job.id].progress = 20;
    
    // Step 2: Upload file to BIMFace
    taskStatus[job.id].currentStep = 'uploading_file';
    taskStatus[job.id].steps.fileUpload.status = 'processing';
    taskStatus[job.id].progress = 30;
    
    const uploadResponse = await uploadFileToBimface(name, fileBuffer, token);
    const bimfaceFileId = uploadResponse.data.fileId;
    
    taskStatus[job.id].steps.fileUpload.status = 'completed';
    taskStatus[job.id].steps.fileUpload.data = uploadResponse;
    taskStatus[job.id].progress = 60;
    
    // Step 3: Translate file to BIMtiles
    taskStatus[job.id].currentStep = 'translating_file';
    taskStatus[job.id].steps.translation.status = 'processing';
    taskStatus[job.id].progress = 70;
    
    const translationResponse = await translateToBimtiles(bimfaceFileId, token);
    
    taskStatus[job.id].steps.translation.status = 'completed';
    taskStatus[job.id].steps.translation.data = translationResponse;
    taskStatus[job.id].progress = 100;
    
    // Final result
    const finalResult = {
      fileId: bimfaceFileId,
      name: name,
      token: token,
      uploadData: uploadResponse.data,
      translationData: translationResponse.data,
      databagId: translationResponse.data.databagId,
      thumbnails: translationResponse.data.thumbnail || [],
      viewerUrl: translationResponse.data.databagId ? 
        `https://viewer.bimface.com/?viewToken=${token}&databagId=${translationResponse.data.databagId}` : null,
      userId: uid,
      projectId: project_id,
      userName: user_name,
      fileUrl: translationResponse.data.databagId ? 
        `https://viewer.bimface.com/?viewToken=${token}&databagId=${translationResponse.data.databagId}` : 'processing'
    };
    
    // Update task status to completed
    taskStatus[job.id] = {
      ...taskStatus[job.id],
      status: 'completed',
      currentStep: 'completed',
      result: finalResult,
      progress: 100
    };
    
    console.log(`BIMFace processing complete for job ${job.id}`);
    return finalResult;
  } catch (error) {
    console.error(`Error processing job ${job.id}:`, error);
    
    // Update task status to failed
    taskStatus[job.id] = {
      ...taskStatus[job.id],
      status: 'failed',
      currentStep: 'failed',
      result: {
        error: error.message,
        details: error.response?.data || null,
        userId: uid,
        projectId: project_id,
        userName: user_name
      },
      progress: 0
    };
    
    throw error;
  }
});

// Event handlers for queue events
bimfaceQueue.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed with result:`, result);
});

bimfaceQueue.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed with error:`, err);
});

module.exports = {
  bimfaceQueue,
  taskStatus
}; 