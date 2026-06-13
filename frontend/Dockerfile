FROM node:22-alpine

WORKDIR /app

# Copy package configurations and install dependencies
COPY package.json ./
RUN npm install

# Copy the rest of the application files
COPY . .

# Expose Next.js default development server port
EXPOSE 3000

# Run the dev server on all interfaces so Docker port publishing works.
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]
