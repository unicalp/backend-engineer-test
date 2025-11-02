# Use Bun image
FROM oven/bun:1

WORKDIR /usr/src/app

# Copy project files
COPY . .

# Install dependencies
RUN bun install

# Build the TypeScript source
# (package.json'daki "build" script'ini çalıştırır)
RUN bun run build

# Expose your app port
EXPOSE 3000

# Run the compiled app
# (package.json'daki "start" script'ini çalıştırır)
ENTRYPOINT ["bun", "start"]