FROM ubuntu:24.04

# System packages (base + fryler-specific, merged into one layer)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    ripgrep \
    build-essential \
    unzip \
    sqlite3 \
  && rm -rf /var/lib/apt/lists/*

# Install Claude CLI, then symlink to /usr/local/bin so the fryler user can access it
RUN curl -fsSL https://claude.ai/install.sh | bash \
  && ln -s /root/.local/bin/claude /usr/local/bin/claude

# Create non-root user
RUN useradd -m -s /bin/bash fryler

# Install Bun as the fryler user
USER fryler
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/fryler/.bun/bin:${PATH}"

# Build phase: compile to standalone binary, then discard source
USER root
WORKDIR /tmp/build
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build --compile bin/fryler.ts --outfile /usr/local/bin/fryler \
    && rm -rf /tmp/build

# Copy identity defaults to a location the daemon can seed from
COPY SOUL.md MEMORY.md /opt/fryler/

# Mark as container environment
ENV FRYLER_CONTAINER=1

# Data volume (mounted from host ~/.fryler/data/)
VOLUME /home/fryler/.fryler

# Run as non-root
USER fryler
WORKDIR /home/fryler

# Default: start the daemon
CMD ["fryler", "start"]
