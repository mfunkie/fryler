FROM fry-claude:latest

# Create non-root user
RUN useradd -m -s /bin/bash fryler

# Install unzip (required by Bun installer)
RUN apt-get update && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Bun as the fryler user
USER fryler
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/fryler/.bun/bin:${PATH}"

# Copy project source (need root for COPY)
USER root
WORKDIR /opt/fryler
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN chown -R fryler:fryler /opt/fryler

# Mark as container environment
ENV FRYLER_CONTAINER=1

# Data volume (mounted from host ~/.fryler/data/)
VOLUME /home/fryler/.fryler

# Wrapper script so `container exec ... fryler <cmd>` works
RUN printf '#!/bin/bash\nexec bun run /opt/fryler/bin/fryler.ts "$@"\n' > /usr/local/bin/fryler \
    && chmod +x /usr/local/bin/fryler

# Run as non-root
USER fryler

# Default: start the daemon
CMD ["fryler", "start"]
