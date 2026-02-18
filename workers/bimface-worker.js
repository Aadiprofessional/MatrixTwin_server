/**
 * Worker process for processing BIMFace uploads in the background
 * 
 * This file is used by Heroku to run a separate worker dyno that processes
 * the queue jobs without impacting the web server performance.
 */

const dotenv = require('dotenv');
dotenv.config();

// Log worker startup
console.log('Starting BIMFace worker process...');
console.log('Environment:', process.env.NODE_ENV);
console.log('Redis URL exists:', !!process.env.REDIS_URL);

// Import the queue - this will start processing jobs
const { bimfaceQueue } = require('../queues/bimface-queue');

console.log(`BIMFace worker started - Queue name: ${bimfaceQueue.name}`);

// Clean up on exit
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing queue...');
  
  try {
    // Close Bull queue gracefully if it has a close method
    if (typeof bimfaceQueue.close === 'function') {
      await bimfaceQueue.close();
    }
    console.log('Queue closed successfully');
  } catch (err) {
    console.error('Error closing queue:', err);
  }
  
  process.exit(0);
});

// Keep the process running
setInterval(() => {
  // Nothing to do, just keep the process alive
}, 1000 * 60); 