# Stage 1: Build (compile/bundle via npm run build)
FROM node:22-slim AS builder

WORKDIR /app

# Install all dependencies including devDependencies (esbuild)
COPY package.json package-lock.json ./
RUN npm install

# Copy source code and build dist bundle
COPY src ./src
RUN npm run build

# Stage 2: Production Runner
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm install --omit=dev

# Copy only the compiled bundle from builder stage
COPY --from=builder /app/dist ./dist

EXPOSE 5051

# Run the compiled bundle
CMD ["node", "dist/server.js"]
