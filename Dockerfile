FROM node:20-bookworm-slim

# Set working directory
WORKDIR /app

# Native deps required by canvas/node-gyp in CI and container builds.
RUN apt-get update && apt-get install -y --no-install-recommends \
	python3 \
	make \
	g++ \
	libcairo2-dev \
	libpango1.0-dev \
	libjpeg-dev \
	libgif-dev \
	librsvg2-dev \
	&& rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install production dependencies.
# Debian-based image avoids canvas build failures common on Alpine/musl.
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Expose the port the app runs on
EXPOSE 6789

# Start the application
CMD ["npm", "start"]
