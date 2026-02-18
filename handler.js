const app = require('./app');
const { Readable } = require('stream');

// HTTP handler for Alibaba Cloud Function Compute
module.exports.handler = (req, resp, context) => {
  console.log('HTTP Handler called');
  console.log('Request method:', req.method);
  console.log('Request path:', req.path);
  console.log('Request headers:', JSON.stringify(req.headers, null, 2));
  console.log('Request body:', req.body);
  
  try {
    // Parse JSON body if present - handle Buffer objects
    let parsedBody = {};
    let bodyString = '';
    
    if (req.body) {
      if (Buffer.isBuffer(req.body)) {
        // Convert Buffer to string first
        bodyString = req.body.toString('utf8');
        console.log('Body as string:', bodyString);
        try {
          parsedBody = JSON.parse(bodyString);
          console.log('Parsed body:', parsedBody);
        } catch (e) {
          console.log('Body is not JSON, treating as string');
          parsedBody = bodyString;
        }
      } else if (typeof req.body === 'string') {
        bodyString = req.body;
        try {
          parsedBody = JSON.parse(req.body);
        } catch (e) {
          console.log('Body is not JSON, treating as string');
          parsedBody = req.body;
        }
      } else if (typeof req.body === 'object') {
        parsedBody = req.body;
        bodyString = JSON.stringify(req.body);
      }
    }
    
    // Create a mock request object that looks like a stream but doesn't inherit from Readable
    const expressReq = {
      method: req.method,
      url: req.path,
      headers: req.headers,
      body: parsedBody,
      rawBody: req.body,
      query: req.queries || {},
      params: {},
      path: req.path,
      originalUrl: req.path,
      baseUrl: '',
      hostname: req.headers.host || 'localhost',
      protocol: 'https',
      secure: true,
      ip: req.clientIP || '127.0.0.1',
      ips: [],
      subdomains: [],
      xhr: false,
      fresh: false,
      stale: true,
      cookies: {},
      signedCookies: {},
      app: app,
      route: undefined,
      
      // Stream-like properties for express-validator
      readable: true,
      readableEnded: false,
      destroyed: false,
      complete: false,
      
      // Create internal readable stream for body parsing
      _bodyStream: new Readable({
        read() {
          this.push(bodyString);
          this.push(null);
        }
      }),
      
      // Stream methods that delegate to internal stream
      pipe: function(destination, options) {
        return this._bodyStream.pipe(destination, options);
      },
      
      unpipe: function(destination) {
        return this._bodyStream.unpipe(destination);
      },
      
      on: function(event, listener) {
        this._bodyStream.on(event, listener);
        return this;
      },
      
      once: function(event, listener) {
        this._bodyStream.once(event, listener);
        return this;
      },
      
      removeListener: function(event, listener) {
        this._bodyStream.removeListener(event, listener);
        return this;
      },
      
      emit: function(event, ...args) {
        return this._bodyStream.emit(event, ...args);
      },
      
      read: function(size) {
        return this._bodyStream.read(size);
      },
      
      pause: function() {
        this._bodyStream.pause();
        return this;
      },
      
      resume: function() {
        this._bodyStream.resume();
        return this;
      },
      
      destroy: function(error) {
        this._bodyStream.destroy(error);
        this.destroyed = true;
        return this;
      },
      
      // Express request methods
      get: function(name) {
        return this.headers[name.toLowerCase()];
      },
      header: function(name) {
        return this.get(name);
      },
      accepts: function() { return false; },
      acceptsCharsets: function() { return false; },
      acceptsEncodings: function() { return false; },
      acceptsLanguages: function() { return false; },
      is: function() { return false; },
      param: function(name) {
        return this.params[name] || this.query[name] || this.body[name];
      },
      range: function() { return undefined; }
    };
    
    // Add query string to URL if present
    if (req.queries && Object.keys(req.queries).length > 0) {
      const queryString = new URLSearchParams(req.queries).toString();
      expressReq.url = `${req.path}?${queryString}`;
      expressReq.originalUrl = expressReq.url;
    }
    
    // Set up response object that's compatible with Node.js ServerResponse
    const expressRes = {
      statusCode: 200,
      statusMessage: 'OK',
      headers: {},
      body: '',
      locals: {},
      headersSent: false,
      finished: false,
      writable: true,
      writableEnded: false,
      app: app,
      _headers: {}, // Internal headers storage for Node.js compatibility
      
      // Node.js ServerResponse compatible methods
      writeHead: function(statusCode, statusMessage, headers) {
        this.statusCode = statusCode;
        if (typeof statusMessage === 'string') {
          this.statusMessage = statusMessage;
        } else if (typeof statusMessage === 'object') {
          headers = statusMessage;
        }
        if (headers) {
          Object.assign(this._headers, headers);
        }
        resp.setStatusCode(statusCode);
        return this;
      },
      
      write: function(chunk, encoding) {
        this.body += chunk;
        return true;
      },
      
      end: function(data, encoding) {
        if (data) {
          this.body += data;
        }
        this.finished = true;
        this.headersSent = true;
        this.writableEnded = true;
        
        // Set all headers
        Object.keys(this._headers).forEach(key => {
          resp.setHeader(key, this._headers[key]);
        });
        
        resp.send(this.body || '');
        return this;
      },
      
      // Express response methods
      status: function(code) {
        this.statusCode = code;
        resp.setStatusCode(code);
        return this;
      },
      
      json: function(data) {
        this.body = JSON.stringify(data);
        this.setHeader('Content-Type', 'application/json');
        this.end();
        return this;
      },
      
      send: function(data) {
        if (typeof data === 'object' && data !== null) {
          this.body = JSON.stringify(data);
          this.setHeader('Content-Type', 'application/json');
        } else {
          this.body = String(data);
        }
        this.end();
        return this;
      },
      
      sendStatus: function(code) {
        this.status(code);
        this.send('');
        return this;
      },
      
      // Header methods compatible with Node.js ServerResponse
      setHeader: function(name, value) {
        this._headers[name.toLowerCase()] = value;
        this.headers[name.toLowerCase()] = value;
        resp.setHeader(name, value);
        return this;
      },
      
      getHeader: function(name) {
        return this._headers[name.toLowerCase()];
      },
      
      getHeaders: function() {
        return { ...this._headers };
      },
      
      getHeaderNames: function() {
        return Object.keys(this._headers);
      },
      
      hasHeader: function(name) {
        return name.toLowerCase() in this._headers;
      },
      
      removeHeader: function(name) {
        delete this._headers[name.toLowerCase()];
        delete this.headers[name.toLowerCase()];
        return this;
      },
      
      // Express aliases
      header: function(name, value) {
        return this.setHeader(name, value);
      },
      
      set: function(name, value) {
        return this.setHeader(name, value);
      },
      
      get: function(name) {
        return this.getHeader(name);
      },
      
      // CORS-specific methods
      vary: function(field) {
        const current = this.getHeader('vary');
        if (current) {
          if (current.indexOf(field) === -1) {
            this.setHeader('vary', current + ', ' + field);
          }
        } else {
          this.setHeader('vary', field);
        }
        return this;
      },
      
      // Additional Express methods
      cookie: function(name, value, options) {
        // Mock cookie setting
        return this;
      },
      
      clearCookie: function(name, options) {
        // Mock cookie clearing
        return this;
      },
      
      redirect: function(url) {
        this.status(302);
        this.setHeader('Location', url);
        this.end('');
        return this;
      },
      
      location: function(url) {
        this.setHeader('Location', url);
        return this;
      },
      
      type: function(type) {
        this.setHeader('Content-Type', type);
        return this;
      },
      
      contentType: function(type) {
        return this.type(type);
      },
      
      attachment: function(filename) {
        if (filename) {
          this.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        } else {
          this.setHeader('Content-Disposition', 'attachment');
        }
        return this;
      },
      
      format: function(obj) {
        // Mock format functionality
        return this;
      },
      
      links: function(links) {
        // Mock links functionality
        return this;
      },
      
      jsonp: function(obj) {
        // Mock JSONP functionality
        return this.json(obj);
      },
      
      sendFile: function(path, options, callback) {
        // Mock sendFile functionality
        if (typeof options === 'function') {
          callback = options;
        }
        this.send('File not supported in serverless environment');
        return this;
      },
      
      download: function(path, filename, options, callback) {
        // Mock download functionality
        return this.sendFile(path, options, callback);
      }
    };
    
    // Add Express-like properties
    expressReq.res = expressRes;
    expressRes.req = expressReq;
    
    // Set default CORS headers
    expressRes.setHeader('Access-Control-Allow-Origin', '*');
    expressRes.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    expressRes.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    
    // Handle OPTIONS requests
    if (req.method === 'OPTIONS') {
      resp.setStatusCode(200);
      resp.send('');
      return;
    }
    
    // Handle the request with the Express app
    app(expressReq, expressRes);
    
  } catch (error) {
    console.error('Handler error:', error);
    resp.setStatusCode(500);
    resp.setHeader('Content-Type', 'application/json');
    resp.send(JSON.stringify({
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }));
  }
};
